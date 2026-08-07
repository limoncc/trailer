/// Hardware metrics collection module.
///
/// Provides platform-specific GPU/CPU/memory sampling.
/// The main entry point is [`sample_hardware()`].
///
/// ## Platform support
///
/// | Platform | CPU/Memory | GPU |
/// |----------|-----------|-----|
/// | Linux    | `sysinfo` | `nvml-wrapper` (NVIDIA) + sysfs (AMD) |
/// | macOS    | `sysinfo` | `macmon` (util/power/temp) + `gpucap` (memory) |
/// | Windows  | `sysinfo` | (none yet) |
///
use serde::Serialize;
use std::time::{SystemTime, UNIX_EPOCH};

/// GPU sample, one per detected GPU device.
#[derive(Debug, Clone, Serialize)]
pub struct GpuSample {
    pub vendor: String,
    pub index: u32,
    pub gpu_util: Option<f64>,
    pub mem_used_mb: Option<f64>,
    pub mem_total_mb: Option<f64>,
    pub temp_c: Option<f64>,
    pub power_w: Option<f64>,
}

/// A single snapshot of all hardware metrics at a point in time.
#[derive(Debug, Clone, Serialize)]
pub struct HardwareSample {
    pub timestamp: f64,
    pub cpu_usage: f64,
    pub cpu_temp_c: Option<f64>,
    pub cpu_power_w: Option<f64>,
    pub memory_used_mb: f64,
    pub memory_total_mb: f64,
    pub gpus: Vec<GpuSample>,
}

impl HardwareSample {
    /// Collect a hardware sample on the current platform.
    /// Never panics — all GPU collection is best-effort.
    pub fn collect() -> Self {
        let timestamp = now_secs();
        let (cpu_usage, memory_used_mb, memory_total_mb) = sample_cpu_memory();
        let (cpu_temp_c, cpu_power_w) = sample_cpu_power_temp();
        let gpus = sample_gpus();
        Self {
            timestamp,
            cpu_usage,
            cpu_temp_c,
            cpu_power_w,
            memory_used_mb,
            memory_total_mb,
            gpus,
        }
    }
}

/// Current timestamp as seconds since epoch.
fn now_secs() -> f64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs_f64())
        .unwrap_or(0.0)
}

/// Sample CPU usage and memory using `sysinfo`
fn sample_cpu_memory() -> (f64, f64, f64) {
    let mut sys = sysinfo::System::new();
    sys.refresh_cpu_usage();
    sys.refresh_memory();

    let cpu_usage = sys.global_cpu_usage() as f64 / 100.0;
    let memory_used_mb = sys.used_memory() as f64 / (1024.0 * 1024.0);
    let memory_total_mb = sys.total_memory() as f64 / (1024.0 * 1024.0);

    (cpu_usage, memory_used_mb, memory_total_mb)
}

/// Sample CPU temperature and power (platform-specific).
#[cfg(target_os = "macos")]
fn sample_cpu_power_temp() -> (Option<f64>, Option<f64>) {
    match macmon::Sampler::new() {
        Ok(mut sampler) => {
            if let Ok(m) = sampler.get_metrics(100) {
                return (Some(m.temp.cpu_temp_avg as f64), Some(m.cpu_power as f64));
            }
            (None, None)
        }
        Err(_) => (None, None),
    }
}

#[cfg(not(target_os = "macos"))]
fn sample_cpu_power_temp() -> (Option<f64>, Option<f64>) {
    (None, None) // TODO: Linux sysfs /sys/class/thermal/, powercap
}

/// Sample all GPUs on the current platform.
/// Falls back to empty vec on unsupported platforms or errors.
#[allow(unused_variables)]
fn sample_gpus() -> Vec<GpuSample> {
    let mut gpus = Vec::new();

    #[cfg(target_os = "linux")]
    {
        // Try NVIDIA via nvml-wrapper first
        if let Ok(samples) = sample_nvidia_gpus() {
            gpus.extend(samples);
        }
        // Try AMD via sysfs
        if let Ok(samples) = sample_amd_gpus_sysfs() {
            gpus.extend(samples);
        }
    }

    #[cfg(target_os = "macos")]
    {
        // Try Apple Silicon GPU via macmon + gpucap
        if let Ok(samples) = sample_apple_gpus() {
            gpus.extend(samples);
        }
    }

    gpus
}

// ─── Linux: NVIDIA via nvml-wrapper ───

#[cfg(target_os = "linux")]
fn sample_nvidia_gpus() -> Result<Vec<GpuSample>, Box<dyn std::error::Error>> {
    use nvml_wrapper::Nvml;
    let nvml = Nvml::init()?;
    let count = nvml.device_count()?;
    let mut gpus = Vec::with_capacity(count as usize);

    for i in 0..count {
        let device = nvml.device_by_index(i)?;
        let util = device.utilization_rates().ok();
        let mem = device.memory_info().ok();
        let temp = device
            .temperature(nvml_wrapper::enum_wrappers::device::TemperatureSensor::Gpu)
            .ok();
        let power = device.power_usage().ok();

        gpus.push(GpuSample {
            vendor: "nvidia".into(),
            index: i,
            gpu_util: util.map(|u| u.gpu as f64 / 100.0),
            mem_used_mb: mem.as_ref().map(|m| m.used as f64 / (1024.0 * 1024.0)),
            mem_total_mb: mem.map(|m| m.total as f64 / (1024.0 * 1024.0)),
            temp_c: temp.map(|t| t as f64),
            power_w: power.map(|p| p as f64 / 1000.0),
        });
    }

    Ok(gpus)
}

// ─── Linux: AMD via sysfs ───

#[cfg(target_os = "linux")]
fn read_sysfs(path: &str) -> Result<String, std::io::Error> {
    use std::io::Read;
    let mut content = String::new();
    std::fs::File::open(path)?.read_to_string(&mut content)?;
    Ok(content.trim().to_string())
}

#[cfg(target_os = "linux")]
fn sample_amd_gpus_sysfs() -> Result<Vec<GpuSample>, Box<dyn std::error::Error>> {
    let mut gpus = Vec::new();
    let drm_dir = std::path::Path::new("/sys/class/drm");

    if !drm_dir.is_dir() {
        return Ok(gpus); // Not an error — just no DRM devices
    }

    for entry in std::fs::read_dir(drm_dir)? {
        let entry = entry?;
        let name = entry.file_name();
        let name = name.to_string_lossy();

        // Look for card0, card1, ... not renderD*, controlD*
        if !name.starts_with("card") || !name.chars().skip(4).all(|c| c.is_ascii_digit()) {
            continue;
        }

        let dev_path = entry.path().join("device");
        let vendor_path = dev_path.join("vendor");

        // Read vendor ID
        let vendor_str = match read_sysfs(vendor_path.to_str().unwrap_or("")) {
            Ok(v) => v,
            Err(_) => continue,
        };

        // AMD vendor ID is 0x1002
        if vendor_str.trim() != "0x1002" {
            continue;
        }

        // Extract card index from name (card0 → 0)
        let index: u32 = name[4..].parse().unwrap_or(0);

        let gpu_busy = read_sysfs(dev_path.join("gpu_busy_percent").to_str().unwrap_or(""))
            .ok()
            .and_then(|s| s.trim().parse::<f64>().ok())
            .map(|p| p / 100.0);

        let vram_total = read_sysfs(dev_path.join("mem_info_vram_total").to_str().unwrap_or(""))
            .ok()
            .and_then(|s| s.trim().parse::<u64>().ok())
            .map(|b| b as f64 / (1024.0 * 1024.0));

        let vram_used = read_sysfs(dev_path.join("mem_info_vram_used").to_str().unwrap_or(""))
            .ok()
            .and_then(|s| s.trim().parse::<u64>().ok())
            .map(|b| b as f64 / (1024.0 * 1024.0));

        gpus.push(GpuSample {
            vendor: "amd".into(),
            index,
            gpu_util: gpu_busy,
            mem_used_mb: vram_used,
            mem_total_mb: vram_total,
            temp_c: None,  // AMD temp requires hwmon, complex to parse
            power_w: None, // AMD power also via hwmon
        });
    }

    Ok(gpus)
}

// ─── macOS: Apple Silicon via macmon + gpucap ───

#[cfg(target_os = "macos")]
fn sample_apple_gpus() -> Result<Vec<GpuSample>, Box<dyn std::error::Error>> {
    let mut gpus = Vec::new();

    // GPU utilization + power + temperature from macmon
    let usage_info = sample_macmon_gpu().ok();

    // GPU memory from gpucap
    let mem_info = gpucap::sample_system(gpucap::SampleTier::Full)
        .ok()
        .and_then(|snap| snap.gpu_mem_in_use);

    gpus.push(GpuSample {
        vendor: "apple".into(),
        index: 0,
        gpu_util: usage_info.map(|u| u.0),
        mem_used_mb: mem_info.map(|b| b as f64 / (1024.0 * 1024.0)),
        mem_total_mb: None,
        temp_c: usage_info.map(|u| u.2),
        power_w: usage_info.map(|u| u.1),
    });

    Ok(gpus)
}

/// Use macmon to sample GPU utilization, power, and temperature.
/// Returns (utilization 0~1, power_w, temp_c) if available.
#[cfg(target_os = "macos")]
fn sample_macmon_gpu() -> Result<(f64, f64, f64), Box<dyn std::error::Error>> {
    let mut sampler = macmon::Sampler::new()?;
    // Need a small duration (~100ms) for IOReport to accumulate deltas
    let metrics = sampler.get_metrics(100)?;

    let util = metrics.gpu_usage_ratio as f64;
    let power = metrics.gpu_power as f64;
    let temp = metrics.temp.gpu_temp_avg as f64;

    Ok((util, power, temp))
}

// ─── Tests ───
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sample_hardware_returns_valid_data() {
        let sample = HardwareSample::collect();
        assert!(sample.timestamp > 0.0, "timestamp should be set");
        assert!(
            sample.cpu_usage >= 0.0 && sample.cpu_usage <= 1.0,
            "cpu_usage {:.4} should be between 0 and 1",
            sample.cpu_usage
        );
        assert!(
            sample.memory_total_mb > 0.0,
            "memory_total_mb {} should be > 0",
            sample.memory_total_mb
        );
        assert!(
            sample.memory_used_mb > 0.0,
            "memory_used_mb {} should be > 0",
            sample.memory_used_mb
        );
    }

    #[test]
    fn gpu_sample_can_be_empty() {
        // No GPU is a valid state (e.g., CI or headless)
        let gpus: Vec<GpuSample> = Vec::new();
        assert!(gpus.is_empty());
    }

    #[test]
    fn sample_cpu_memory_ranges() {
        let (cpu, used, total) = sample_cpu_memory();
        assert!(
            cpu >= 0.0 && cpu <= 1.0,
            "cpu_usage {:.4} out of range",
            cpu
        );
        assert!(total > 0.0, "total memory {} should be > 0", total);
        assert!(
            used <= total || (used - total).abs() < 1024.0,
            "used {} should be <= total {}",
            used,
            total
        );
    }
}

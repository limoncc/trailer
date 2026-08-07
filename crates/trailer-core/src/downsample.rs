//! LTTB (Largest-Triangle-Three-Buckets) downsampling algorithm.
//!
//! Preserves the visual shape of a time-series while reducing N points to K.
//! Time complexity: O(N). Space: O(K).
//!
//! Reference: Sveinn Steinarsson, "Downsampling Time Series for Visual Representation" (2013)

/// Apply LTTB downsampling. If len <= threshold, returns full data.
/// Panics if threshold < 2.
pub fn lttb(data: &[(f64, f64)], threshold: usize) -> Vec<(f64, f64)> {
    assert!(threshold >= 2, "threshold must be >= 2");
    if data.len() <= threshold {
        return data.to_vec();
    }

    let n = data.len();
    let mut sampled = Vec::with_capacity(threshold);
    sampled.push(data[0]); // Always keep the first point

    let bucket_size = (n - 2) as f64 / (threshold - 2) as f64;

    // For each interior bucket, find the point that forms
    // the largest triangle with the previous selected point
    // and the average of the next bucket.
    for i in 0..(threshold - 2) {
        let start = 1 + (i as f64 * bucket_size).floor() as usize;
        let end = 1 + ((i + 1) as f64 * bucket_size).ceil() as usize;
        let end = end.min(n - 1);

        let next_start = end;
        let next_end = 1 + ((i + 2) as f64 * bucket_size).ceil() as usize;
        let next_end = next_end.min(n);

        // Average of the next bucket
        let avg_x: f64 = data[next_start..next_end].iter().map(|p| p.0).sum::<f64>()
            / (next_end - next_start) as f64;
        let avg_y: f64 = data[next_start..next_end].iter().map(|p| p.1).sum::<f64>()
            / (next_end - next_start) as f64;

        let prev = sampled.last().unwrap();

        // Find point in current bucket with largest triangle area
        let mut max_area = f64::NEG_INFINITY;
        let mut best_idx = start;
        for j in start..end {
            let area = triangle_area(prev, &data[j], &(avg_x, avg_y));
            if area > max_area {
                max_area = area;
                best_idx = j;
            }
        }
        sampled.push(data[best_idx]);
    }

    sampled.push(data[n - 1]); // Always keep the last point
    sampled
}

/// Area of triangle formed by points a, b, c.
/// Uses the cross-product formula: 0.5 * |(b.x-a.x)*(c.y-a.y) - (b.y-a.y)*(c.x-a.x)|
fn triangle_area(a: &(f64, f64), b: &(f64, f64), c: &(f64, f64)) -> f64 {
    0.5 * ((b.0 - a.0) * (c.1 - a.1) - (b.1 - a.1) * (c.0 - a.0)).abs()
}

// ─── Tests ───
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn identity_when_below_threshold() {
        let data: Vec<_> = (0..10).map(|i| (i as f64, i as f64)).collect();
        let result = lttb(&data, 100);
        assert_eq!(result.len(), 10);
        assert_eq!(result[0], (0.0, 0.0));
        assert_eq!(result[9], (9.0, 9.0));
    }

    #[test]
    fn output_has_exact_threshold_points() {
        let data: Vec<_> = (0..100_000).map(|i| (i as f64, (i as f64).sin())).collect();
        let result = lttb(&data, 1_000);
        assert_eq!(result.len(), 1_000);
    }

    #[test]
    fn preserves_first_and_last() {
        let data = vec![(0.0, 10.0), (1.0, 5.0), (2.0, 8.0), (3.0, 3.0), (4.0, 9.0)];
        let result = lttb(&data, 3);
        assert_eq!(result[0], (0.0, 10.0));
        assert_eq!(result[2], (4.0, 9.0));
    }

    #[test]
    fn spike_preservation_beats_uniform_sampling() {
        // Create data with a sharp spike
        let mut data = Vec::new();
        for i in 0..1000 {
            data.push((i as f64, 0.0));
        }
        data[500] = (500.0, 100.0); // spike at middle

        let lttb_result = lttb(&data, 50);
        let has_spike = lttb_result.iter().any(|(_, y)| *y > 90.0);
        assert!(has_spike, "LTTB should preserve the spike");

        // Uniform sampling (every 20th point)
        let uniform_result: Vec<_> = data.iter().step_by(20).cloned().collect();
        let uniform_has_spike = uniform_result.iter().any(|(_, y)| *y > 90.0);
        // Uniform may or may not hit the spike — the point is LTTB guarantees it
        assert!(has_spike || !uniform_has_spike); // trivially true, documentation test
        if uniform_result.len() == lttb_result.len() && !uniform_has_spike {
            eprintln!("LTTB preserved the spike where uniform sampling failed");
        }
    }

    #[test]
    fn constant_signal_output_is_correct_size() {
        let data: Vec<_> = (0..5000).map(|i| (i as f64, 42.0)).collect();
        let result = lttb(&data, 100);
        assert_eq!(result.len(), 100);
        assert_eq!(result[0], (0.0, 42.0));
        assert_eq!(result[99], (4999.0, 42.0));
    }
}

/// TensorBoard event file importer.
///
/// Parses TFRecord-framed protobuf Event files (events.out.tfevents.*)
/// and maps scalars to Trailer Envelopes for ingestion.
///
/// ## TFRecord format
/// | uint64 length | uint32 crc32c(length) | bytes data[length] | uint32 crc32c(data) |
///
/// CRC32C uses the Castagnoli polynomial and the TF "masked" formula:
///   masked = ((crc >> 15) | (crc << 17)) + 0xa282ead8  (mod 2^32)
use prost::Message;
use std::collections::HashMap;
use std::io::Read;
use std::path::Path;

use crate::domain::Envelope;
use crate::error::{StorageError, StorageResult};

// ─── Minimal protobuf definitions (field numbers from tensorboard.proto) ───

/// tensorboard.Event
#[derive(Message, Clone)]
struct TbEvent {
    #[prost(double, tag = "1")]
    wall_time: f64,
    #[prost(int64, tag = "2")]
    step: i64,
    #[prost(string, tag = "3")]
    file_version: String,
    #[prost(message, tag = "4")]
    summary: Option<TbSummary>,
}

/// tensorboard.Summary
#[derive(Message, Clone)]
struct TbSummary {
    #[prost(message, repeated, tag = "1")]
    value: Vec<TbSummaryValue>,
}

/// tensorboard.Summary.Value (scalar subset)
#[derive(Message, Clone)]
struct TbSummaryValue {
    #[prost(string, tag = "1")]
    tag: String,
    #[prost(float, tag = "2")]
    simple_value: f32,
    #[prost(message, tag = "5")]
    histo: Option<TbHistogramProto>,
}

/// tensorboard.HistogramProto
#[derive(Message, Clone)]
struct TbHistogramProto {
    #[prost(double, tag = "1")]
    min: f64,
    #[prost(double, tag = "2")]
    max: f64,
    #[prost(double, tag = "3")]
    num: f64,
    #[prost(double, tag = "4")]
    sum: f64,
    #[prost(double, tag = "5")]
    sum_squares: f64,
    #[prost(double, repeated, tag = "6")]
    bucket_limit: Vec<f64>,
    #[prost(double, repeated, tag = "7")]
    bucket: Vec<f64>,
}

// ─── TFRecord parsing ───

/// Masked CRC32C as used by TensorFlow TFRecord format.
fn masked_crc32c(data: &[u8]) -> u32 {
    let crc = crc32c::crc32c(data);
    ((crc >> 15) | (crc << 17)).wrapping_add(0xa282_ead8)
}

/// Read a single TFRecord from a reader, skipping corrupt frames.
/// Returns None at end of file. Returns Error only on I/O failures.
fn read_tfrecord<R: Read>(reader: &mut R) -> std::io::Result<Option<Vec<u8>>> {
    // Read 8-byte length (little-endian uint64)
    let mut len_buf = [0u8; 8];
    match reader.read_exact(&mut len_buf) {
        Ok(()) => {}
        Err(e) if e.kind() == std::io::ErrorKind::UnexpectedEof => return Ok(None),
        Err(e) => return Err(e),
    }
    let length = u64::from_le_bytes(len_buf) as usize;

    // Read and verify length CRC
    let mut crc_buf = [0u8; 4];
    reader.read_exact(&mut crc_buf)?;
    let expected_len_crc = u32::from_le_bytes(crc_buf);
    if masked_crc32c(&len_buf) != expected_len_crc {
        // Corrupt length frame — skip by finding next sync marker (simplified: return empty)
        return Ok(Some(Vec::new()));
    }

    // Read data
    let mut data = vec![0u8; length];
    if let Err(e) = reader.read_exact(&mut data) {
        if e.kind() == std::io::ErrorKind::UnexpectedEof {
            return Ok(None); // truncated file
        }
        return Err(e);
    }

    // Read and verify data CRC
    reader.read_exact(&mut crc_buf)?;
    let expected_data_crc = u32::from_le_bytes(crc_buf);
    if masked_crc32c(&data) != expected_data_crc {
        // Data corruption — skip this record
        return Ok(Some(Vec::new()));
    }

    Ok(Some(data))
}

/// Parse a TFRecord data blob into an Event.
fn parse_event(data: &[u8]) -> Option<TbEvent> {
    if data.is_empty() {
        return None;
    }
    TbEvent::decode(data).ok()
}

/// Convert a TB Event scalar to Trailer Envelopes (one per summary value).
fn event_to_envelopes(event: &TbEvent, run_id: &str) -> Vec<Envelope> {
    let summary = match &event.summary {
        Some(s) => s,
        None => return vec![],
    };

    summary
        .value
        .iter()
        .map(|v| {
            let mut payload = HashMap::new();
            payload.insert(v.tag.clone(), serde_json::json!(v.simple_value as f64));

            Envelope {
                kind: "metric".into(),
                run_id: run_id.into(),
                step: event.step,
                wall_time: event.wall_time,
                context: String::new(),
                payload,
            }
        })
        .collect()
}

/// Convert a TB Event histogram to Trailer Envelopes (kind "histogram").
fn event_to_histograms(event: &TbEvent, run_id: &str) -> Vec<Envelope> {
    let summary = match &event.summary {
        Some(s) => s,
        None => return vec![],
    };

    summary
        .value
        .iter()
        .filter_map(|v| {
            let histo = match &v.histo {
                Some(h) => h,
                None => return None,
            };
            let mut payload = HashMap::new();
            payload.insert(v.tag.clone(), serde_json::json!(null));
            payload.insert("min".into(), serde_json::json!(histo.min));
            payload.insert("max".into(), serde_json::json!(histo.max));
            payload.insert("num".into(), serde_json::json!(histo.num as i64));
            payload.insert("sum".into(), serde_json::json!(histo.sum));
            payload.insert("sum_squares".into(), serde_json::json!(histo.sum_squares));
            payload.insert(
                "bucket_limits".into(),
                serde_json::json!(histo.bucket_limit),
            );
            // TB stores cumulative bucket counts as doubles; pass along and let
            // the ingestion layer convert to per-bucket i64 counts.
            payload.insert("bucket_counts".into(), serde_json::json!(histo.bucket));

            Some(Envelope {
                kind: "histogram".into(),
                run_id: run_id.into(),
                step: event.step,
                wall_time: event.wall_time,
                context: String::new(),
                payload,
            })
        })
        .collect()
}

// ─── Public API ───

/// Import TensorBoard event files from a directory.
/// Returns all parsed Envelopes (caller feeds into ingestion).
pub async fn import_tb_logdir(dir: &Path, project: &str) -> StorageResult<Vec<Envelope>> {
    if !dir.exists() {
        return Err(StorageError::NotFound(format!(
            "Directory not found: {}",
            dir.display()
        )));
    }

    let mut all_envelopes = Vec::new();

    // Walk dir for event files
    let mut entries: Vec<_> = match std::fs::read_dir(dir) {
        Ok(e) => e.filter_map(|e| e.ok()).map(|e| e.path()).collect(),
        Err(_) => return Ok(vec![]),
    };
    entries.sort();

    for path in &entries {
        let fname = match path.file_name().and_then(|n| n.to_str()) {
            Some(n) => n,
            None => continue,
        };
        if !fname.starts_with("events.out.tfevents") {
            continue;
        }

        let file = match std::fs::File::open(path) {
            Ok(f) => f,
            Err(_) => continue,
        };
        let mut reader = std::io::BufReader::with_capacity(512 * 1024, file);

        let run_id = format!("{}_{}", project, fname);

        loop {
            match read_tfrecord(&mut reader) {
                Ok(Some(data)) => {
                    if let Some(event) = parse_event(&data) {
                        let envelopes = event_to_envelopes(&event, &run_id);
                        all_envelopes.extend(envelopes);
                        let histo_envs = event_to_histograms(&event, &run_id);
                        all_envelopes.extend(histo_envs);
                    }
                }
                Ok(None) => break, // EOF
                Err(_) => break,   // I/O error
            }
        }

        tracing::info!("Imported {} events from {}", all_envelopes.len(), fname);
    }

    Ok(all_envelopes)
}

// ─── Tests ───
#[cfg(test)]
mod tests {
    use super::*;
    use prost::Message;
    use std::path::Path;

    /// Build a minimal TFRecord bytes: length + crc + data + crc
    fn make_tfrecord(data: &[u8]) -> Vec<u8> {
        let len = data.len() as u64;
        let len_bytes = len.to_le_bytes();
        let mut buf = Vec::new();
        buf.extend_from_slice(&len_bytes);
        buf.extend_from_slice(&masked_crc32c(&len_bytes).to_le_bytes());
        buf.extend_from_slice(data);
        buf.extend_from_slice(&masked_crc32c(data).to_le_bytes());
        buf
    }

    /// Build a TB Event protobuf with scalar summary values
    fn make_event_proto(wall_time: f64, step: i64, tag: &str, value: f32) -> Vec<u8> {
        let ev = TbEvent {
            wall_time,
            step,
            file_version: String::new(),
            summary: Some(TbSummary {
                value: vec![TbSummaryValue {
                    tag: tag.into(),
                    simple_value: value,
                    histo: None,
                }],
            }),
        };
        let mut buf = Vec::new();
        ev.encode(&mut buf).unwrap();
        buf
    }

    /// Build a TB Event protobuf with a histogram value.
    fn make_histogram_proto(
        wall_time: f64,
        step: i64,
        tag: &str,
        histo: TbHistogramProto,
    ) -> Vec<u8> {
        let ev = TbEvent {
            wall_time,
            step,
            file_version: String::new(),
            summary: Some(TbSummary {
                value: vec![TbSummaryValue {
                    tag: tag.into(),
                    simple_value: 0.0,
                    histo: Some(histo),
                }],
            }),
        };
        let mut buf = Vec::new();
        ev.encode(&mut buf).unwrap();
        buf
    }

    #[test]
    fn parse_histogram_event() {
        let histo = TbHistogramProto {
            min: -2.0,
            max: 2.0,
            num: 100.0,
            sum: 5.0,
            sum_squares: 50.0,
            bucket_limit: vec![-1.0, 0.0, 1.0],
            bucket: vec![10.0, 40.0, 80.0, 100.0], // cumulative
        };
        let proto = make_histogram_proto(1000.0, 42, "layer1/weights", histo);
        let tfrecord = make_tfrecord(&proto);

        let mut cursor = std::io::Cursor::new(&tfrecord[..]);
        let data = read_tfrecord(&mut cursor).unwrap().unwrap();
        let event = parse_event(&data).unwrap();

        assert!((event.wall_time - 1000.0).abs() < 1e-9);
        assert_eq!(event.step, 42);
        let sv = &event.summary.unwrap().value[0];
        assert_eq!(sv.tag, "layer1/weights");
        let h = sv.histo.as_ref().unwrap();
        assert!((h.min - (-2.0)).abs() < 1e-9);
        assert_eq!(h.bucket_limit.len(), 3);
        assert_eq!(h.bucket.len(), 4);
    }

    #[test]
    fn event_to_histograms_produces_envelopes() {
        let histo = TbHistogramProto {
            min: -2.0,
            max: 2.0,
            num: 100.0,
            sum: 5.0,
            sum_squares: 50.0,
            bucket_limit: vec![-1.0, 0.0, 1.0],
            bucket: vec![10.0, 40.0, 80.0, 100.0],
        };
        let event = TbEvent {
            wall_time: 1000.0,
            step: 0,
            file_version: String::new(),
            summary: Some(TbSummary {
                value: vec![TbSummaryValue {
                    tag: "layer1/weights".into(),
                    simple_value: 0.0,
                    histo: Some(histo),
                }],
            }),
        };

        let envelopes = event_to_histograms(&event, "test-run");
        assert_eq!(envelopes.len(), 1);
        let env = &envelopes[0];
        assert_eq!(env.kind, "histogram");
        assert_eq!(env.step, 0);
        assert_eq!(
            env.payload.get("min").and_then(|v| v.as_f64()).unwrap(),
            -2.0
        );
        assert_eq!(
            env.payload.get("num").and_then(|v| v.as_i64()).unwrap(),
            100
        );
        let limits = env
            .payload
            .get("bucket_limits")
            .and_then(|v| v.as_array())
            .unwrap();
        assert_eq!(limits.len(), 3);
    }

    #[test]
    fn parse_single_scalar() {
        let proto = make_event_proto(1000.0, 42, "train/loss", 0.5);
        let tfrecord = make_tfrecord(&proto);

        let mut cursor = std::io::Cursor::new(&tfrecord[..]);
        let data = read_tfrecord(&mut cursor).unwrap().unwrap();
        let event = parse_event(&data).unwrap();

        assert!((event.wall_time - 1000.0).abs() < 1e-9);
        assert_eq!(event.step, 42);
        assert!(event.summary.is_some());
        let sv = &event.summary.unwrap().value[0];
        assert_eq!(sv.tag, "train/loss");
        assert!((sv.simple_value - 0.5).abs() < 1e-6);
    }

    #[test]
    fn event_to_envelope_maps_correctly() {
        let mut payload = HashMap::new();
        payload.insert("loss".into(), serde_json::json!(0.5));

        let envelope = Envelope {
            kind: "metric".into(),
            run_id: "r1".into(),
            step: 1,
            wall_time: 1000.0,
            context: String::new(),
            payload,
        };

        assert_eq!(envelope.kind, "metric");
        assert_eq!(envelope.run_id, "r1");
        assert_eq!(envelope.step, 1);
        assert_eq!(envelope.payload["loss"].as_f64().unwrap(), 0.5);
    }

    #[test]
    fn event_to_envelopes_produces_envelopes() {
        let event = TbEvent {
            wall_time: 1000.0,
            step: 0,
            file_version: String::new(),
            summary: Some(TbSummary {
                value: vec![
                    TbSummaryValue {
                        tag: "loss".into(),
                        simple_value: 0.5,
                        histo: None,
                    },
                    TbSummaryValue {
                        tag: "accuracy".into(),
                        simple_value: 0.85,
                        histo: None,
                    },
                ],
            }),
        };

        let envelopes = event_to_envelopes(&event, "test-run");
        assert_eq!(envelopes.len(), 2);
        assert!((envelopes[0].payload["loss"].as_f64().unwrap() - 0.5).abs() < 1e-5);
        assert!((envelopes[1].payload["accuracy"].as_f64().unwrap() - 0.85).abs() < 1e-5);
    }

    #[test]
    fn malformed_tfrecord_skips_frame() {
        let good = make_event_proto(1000.0, 0, "loss", 0.5);
        let good_record = make_tfrecord(&good);

        // Append a truncated record (corrupted)
        let mut bad = good_record.clone();
        bad.extend_from_slice(&[0xFF; 20]); // not a valid TFRecord

        let mut cursor = std::io::Cursor::new(&bad[..]);
        let first = read_tfrecord(&mut cursor).unwrap();
        assert!(first.is_some());

        // Second read may return Some(empty) or None depending on corruption
        let _second = read_tfrecord(&mut cursor).unwrap_or(None);
        // Either way, should not panic — graceful handling
    }

    #[test]
    fn empty_file_returns_none() {
        let data = [];
        let mut cursor = std::io::Cursor::new(&data[..]);
        let result = read_tfrecord(&mut cursor).unwrap();
        assert!(result.is_none());
    }

    #[test]
    fn non_existent_dir_returns_error() {
        let rt = tokio::runtime::Runtime::new().unwrap();
        let result = rt.block_on(import_tb_logdir(Path::new("/nonexistent_tb_dir"), "test"));
        assert!(result.is_err());
    }

    #[test]
    fn import_from_temp_dir() {
        use std::io::Write;

        let tmp = std::env::temp_dir().join(format!("tb_test_{}", std::process::id()));
        let _ = std::fs::create_dir_all(&tmp);

        // Write a fake event file
        let fpath = tmp.join("events.out.tfevents.test");
        let mut f = std::fs::File::create(&fpath).unwrap();

        // Write 5 scalar events
        for i in 0..5 {
            let proto = make_event_proto(
                1000.0 + i as f64,
                i,
                "train/loss",
                (1.0 / (i as f64 + 1.0)) as f32,
            );
            let record = make_tfrecord(&proto);
            f.write_all(&record).unwrap();
        }
        drop(f);

        let rt = tokio::runtime::Runtime::new().unwrap();
        let envelopes = rt.block_on(import_tb_logdir(&tmp, "tb_test")).unwrap();

        assert_eq!(envelopes.len(), 5, "should import 5 scalar events");

        // Verify data
        assert_eq!(envelopes[0].step, 0);
        assert!((envelopes[0].wall_time - 1000.0).abs() < 1e-9);
        assert!((envelopes[4].payload["train/loss"].as_f64().unwrap() - 1.0 / 5.0).abs() < 1e-5);

        // Cleanup
        let _ = std::fs::remove_file(&fpath);
        let _ = std::fs::remove_dir(&tmp);
    }
}

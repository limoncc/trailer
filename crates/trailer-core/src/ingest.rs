/// Ingestion helpers: Envelope encoding, context parsing, batch routing.
use crate::domain::{Envelope, HistogramRow, MetricRow};

/// Parse a metric key string (e.g. "train/loss" or "loss") into (key, context).
///
/// TensorBoard convention: prefix separated by `/` maps to context.
///   "train/loss" → key="loss", context="train"
///   "val/accuracy" → key="accuracy", context="val"
///   "loss" → key="loss", context=""
///   "a/b/c" → key="c", context="a/b"   (multi-level prefix → context)
pub fn parse_key_context(raw_key: &str) -> (String, String) {
    match raw_key.rfind('/') {
        Some(pos) => {
            let context = raw_key[..pos].to_string();
            let key = raw_key[pos + 1..].to_string();
            (key, context)
        }
        None => (raw_key.to_string(), String::new()),
    }
}

/// Convert an Envelope of kind "metric" into one or more MetricRow records.
pub fn envelope_to_metrics(env: &Envelope) -> Vec<MetricRow> {
    let mut rows = Vec::new();
    if env.kind != "metric" {
        return rows;
    }
    for (raw_key, val) in &env.payload {
        let (key, context) = parse_key_context(raw_key);
        if let Some(v) = val.as_f64() {
            rows.push(MetricRow {
                run_id: env.run_id.clone(),
                step: env.step,
                wall_time: env.wall_time,
                key,
                context,
                value: v,
            });
        }
    }
    rows
}

/// Convert an Envelope of kind "histogram" into HistogramRow records.
pub fn envelope_to_histograms(env: &Envelope) -> Vec<HistogramRow> {
    if env.kind != "histogram" {
        return vec![];
    }

    // Identify the tag key from payload — skip known structural fields.
    let known_fields: std::collections::HashSet<&str> = [
        "min",
        "max",
        "num",
        "sum",
        "sum_squares",
        "bucket_limits",
        "bucket_counts",
    ]
    .into();
    let tag = match env
        .payload
        .keys()
        .find(|k| !known_fields.contains(k.as_str()))
    {
        Some(t) => t.clone(),
        None => return vec![],
    };
    let (key, context) = parse_key_context(&tag);

    let min = env
        .payload
        .get("min")
        .and_then(|v| v.as_f64())
        .unwrap_or(0.0);
    let max = env
        .payload
        .get("max")
        .and_then(|v| v.as_f64())
        .unwrap_or(0.0);
    let num = env.payload.get("num").and_then(|v| v.as_i64()).unwrap_or(0);
    let sum = env
        .payload
        .get("sum")
        .and_then(|v| v.as_f64())
        .unwrap_or(0.0);
    let sum_squares = env
        .payload
        .get("sum_squares")
        .and_then(|v| v.as_f64())
        .unwrap_or(0.0);

    let bucket_limits: Vec<f64> = env
        .payload
        .get("bucket_limits")
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .unwrap_or_default();

    let bucket_counts_raw: Vec<f64> = env
        .payload
        .get("bucket_counts")
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .unwrap_or_default();

    // TB stores cumulative bucket counts as doubles. Detected by monotonicity.
    let is_cumulative =
        bucket_counts_raw.len() > 1 && bucket_counts_raw.windows(2).all(|w| w[1] >= w[0]);
    let bucket_counts: Vec<i64> = if is_cumulative {
        let mut prev = 0.0_f64;
        bucket_counts_raw
            .iter()
            .map(|&c| {
                let diff = (c - prev).max(0.0).round() as i64;
                prev = c;
                diff
            })
            .collect()
    } else {
        bucket_counts_raw
            .iter()
            .map(|&c| c.round() as i64)
            .collect()
    };

    vec![HistogramRow {
        run_id: env.run_id.clone(),
        step: env.step,
        wall_time: env.wall_time,
        key,
        context,
        bucket_limits,
        bucket_counts,
        min,
        max,
        num,
        sum,
        sum_squares,
    }]
}

/// Batch writer with optional taps for summary/sse processing.
pub async fn run_ingestion_writer(
    rx: tokio::sync::mpsc::Receiver<Vec<Envelope>>,
    store: std::sync::Arc<dyn crate::storage::Storage>,
) {
    run_ingestion_writer_with_taps(rx, store, vec![]).await;
}

/// Full ingestion writer with registered taps (Summary, SSE, Alerts).
pub async fn run_ingestion_writer_with_taps(
    mut rx: tokio::sync::mpsc::Receiver<Vec<Envelope>>,
    store: std::sync::Arc<dyn crate::storage::Storage>,
    taps: Vec<Box<dyn crate::taps::BatchTap>>,
) {
    let mut total: u64 = 0;
    while let Some(batch) = rx.recv().await {
        let mut rows = Vec::new();
        let mut histo_rows = Vec::new();
        for env in &batch {
            rows.extend(envelope_to_metrics(env));
            histo_rows.extend(envelope_to_histograms(env));
        }
        if !rows.is_empty() {
            if let Err(e) = store.insert_metrics(&rows).await {
                tracing::error!(?e, count = rows.len(), "insert_metrics failed");
            }
            total += rows.len() as u64;
        }
        if !histo_rows.is_empty() {
            if let Err(e) = store.insert_histograms(&histo_rows).await {
                tracing::error!(?e, count = histo_rows.len(), "insert_histograms failed");
            }
        }
        // Side-band: notify taps
        for tap in &taps {
            if let Err(e) = tap.on_batch(&batch).await {
                tracing::warn!(?e, "tap processing failed");
            }
        }
    }
    tracing::info!(total, "ingestion writer finished");
}

// ─── Tests ───
#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::Envelope;
    use std::collections::HashMap;

    // ─── Round-trip ───
    #[test]
    fn msgpack_roundtrip_metric_envelope() {
        let mut payload = HashMap::new();
        payload.insert("train/loss".into(), serde_json::json!(0.5));
        payload.insert("lr".into(), serde_json::json!(0.001));

        let original = Envelope {
            kind: "metric".into(),
            run_id: "run-1".into(),
            step: 42,
            wall_time: 1234.5,
            context: String::new(),
            payload,
        };

        // Serialize to msgpack
        let bytes = rmp_serde::to_vec(&original).expect("msgpack encode failed");

        // Deserialize back
        let decoded: Envelope = rmp_serde::from_slice(&bytes).expect("msgpack decode failed");

        assert_eq!(decoded.kind, original.kind);
        assert_eq!(decoded.run_id, original.run_id);
        assert_eq!(decoded.step, original.step);
        assert_eq!(decoded.wall_time, original.wall_time);
        assert_eq!(decoded.payload.len(), 2);
        assert!((decoded.payload["train/loss"].as_f64().unwrap() - 0.5).abs() < 1e-9);
    }

    // ─── Context parsing ───
    #[test]
    fn parse_simple_key() {
        let (key, ctx) = parse_key_context("loss");
        assert_eq!(key, "loss");
        assert_eq!(ctx, "");
    }

    #[test]
    fn parse_prefixed_key() {
        let (key, ctx) = parse_key_context("train/loss");
        assert_eq!(key, "loss");
        assert_eq!(ctx, "train");
    }

    #[test]
    fn parse_multi_level_prefix() {
        let (key, ctx) = parse_key_context("a/b/c");
        assert_eq!(key, "c");
        assert_eq!(ctx, "a/b");
    }

    #[test]
    fn parse_root_key() {
        let (key, ctx) = parse_key_context("/root");
        assert_eq!(key, "root");
        assert_eq!(ctx, "");
    }

    // ─── Envelope → MetricRow ───
    #[test]
    fn envelope_to_metrics_converts_correctly() {
        let mut payload = HashMap::new();
        payload.insert("train/loss".into(), serde_json::json!(0.5));
        payload.insert("val/loss".into(), serde_json::json!(0.8));
        payload.insert("lr".into(), serde_json::json!(0.001));

        let env = Envelope {
            kind: "metric".into(),
            run_id: "r1".into(),
            step: 10,
            wall_time: 2000.0,
            context: String::new(),
            payload,
        };

        let rows = envelope_to_metrics(&env);
        assert_eq!(rows.len(), 3);

        // Find the train/loss row
        let train_loss = rows
            .iter()
            .find(|r| r.key == "loss" && r.context == "train")
            .unwrap();
        assert!((train_loss.value - 0.5).abs() < 1e-9);
        assert_eq!(train_loss.step, 10);

        // val/loss
        let val_loss = rows
            .iter()
            .find(|r| r.key == "loss" && r.context == "val")
            .unwrap();
        assert!((val_loss.value - 0.8).abs() < 1e-9);

        // lr (no context)
        let lr = rows
            .iter()
            .find(|r| r.key == "lr" && r.context == "")
            .unwrap();
        assert!((lr.value - 0.001).abs() < 1e-9);
    }

    #[test]
    fn non_metric_envelope_produces_no_rows() {
        let env = Envelope {
            kind: "text".into(),
            run_id: "r1".into(),
            step: 1,
            wall_time: 0.0,
            context: String::new(),
            payload: HashMap::new(),
        };
        let rows = envelope_to_metrics(&env);
        assert!(rows.is_empty());
    }
}

/// Ingest pipeline taps: Summary & SSE.
/// Both are "batch consumers" registered alongside the main Writer.
use crate::domain::{Envelope, SummaryRow};
use crate::downsample::lttb;
use crate::error::StorageResult;
use crate::ingest::envelope_to_metrics;
use crate::storage::Storage;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::broadcast;

// ─── BatchTap trait ───

/// A tap that observes every ingested batch of Envelopes.
/// The main ingestion loop calls `on_batch` for each tap after writing metrics.
#[async_trait::async_trait]
pub trait BatchTap: Send + Sync {
    /// Called with the raw envelopes after they've been written to storage.
    async fn on_batch(&self, envelopes: &[Envelope]) -> StorageResult<()>;
}

// ─── SummaryTap ───

/// 指标方向:best 按"越小越好"还是"越大越好"计算。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MetricDirection {
    Minimize,
    Maximize,
}

/// 按指标名约定推断方向(loss/error→minimize;acc/score 等→maximize),默认 minimize。
pub fn infer_direction(key: &str) -> MetricDirection {
    let k = key.to_lowercase();
    if [
        "acc",
        "accuracy",
        "auc",
        "f1",
        "recall",
        "precision",
        "score",
        "iou",
        "ndcg",
        "miou",
        "ap",
        "dice",
        "mcc",
    ]
    .iter()
    .any(|s| k.contains(s))
    {
        MetricDirection::Maximize
    } else {
        MetricDirection::Minimize
    }
}

/// Incrementally maintains run_summary as metrics arrive.
/// Uses an in-memory state per (run_id, key, context) tuple.
pub struct SummaryTap {
    store: Arc<dyn Storage>,
    state: tokio::sync::Mutex<HashMap<(String, String, String), SummaryAccumulator>>,
    /// run_id → (metric key → 方向) 缓存,来自 run.config.metric_directions
    dirs: tokio::sync::Mutex<HashMap<String, HashMap<String, MetricDirection>>>,
}

/// Per-metric incremental accumulator.
#[derive(Debug, Clone)]
struct SummaryAccumulator {
    last: f64,
    min: f64,
    max: f64,
    best: f64,
    best_step: i64,
    count: u64,
    direction: MetricDirection,
}

impl SummaryTap {
    pub fn new(store: Arc<dyn Storage>) -> Self {
        Self {
            store,
            state: tokio::sync::Mutex::new(HashMap::new()),
            dirs: tokio::sync::Mutex::new(HashMap::new()),
        }
    }

    /// 解析某 run 某指标的方向:显式声明(config.metric_directions) > 命名约定 > 默认 minimize。
    /// 首次遇到该 run 时读 config 并缓存整表,避免每批重复查 run。
    async fn direction_for(&self, run_id: &str, key: &str) -> MetricDirection {
        let cached = { self.dirs.lock().await.get(run_id).cloned() };
        if let Some(map) = cached {
            return map
                .get(key)
                .copied()
                .unwrap_or_else(|| infer_direction(key));
        }

        let mut map = HashMap::new();
        if let Ok(Some(run)) = self.store.get_run(run_id).await {
            if let Some(obj) = run
                .config
                .get("metric_directions")
                .and_then(|v| v.as_object())
            {
                for (k, v) in obj {
                    if let Some(s) = v.as_str() {
                        let d = if s.eq_ignore_ascii_case("max")
                            || s.eq_ignore_ascii_case("maximize")
                        {
                            MetricDirection::Maximize
                        } else {
                            MetricDirection::Minimize
                        };
                        map.insert(k.clone(), d);
                    }
                }
            }
        }
        let dir = map
            .get(key)
            .copied()
            .unwrap_or_else(|| infer_direction(key));
        self.dirs.lock().await.insert(run_id.to_string(), map);
        dir
    }
}

#[async_trait::async_trait]
impl BatchTap for SummaryTap {
    async fn on_batch(&self, envelopes: &[Envelope]) -> StorageResult<()> {
        let mut summaries: Vec<SummaryRow> = Vec::new();
        let mut state = self.state.lock().await;

        for env in envelopes {
            let metrics = envelope_to_metrics(env);
            for m in &metrics {
                let direction = self.direction_for(&m.run_id, &m.key).await;
                let key = (m.run_id.clone(), m.key.clone(), m.context.clone());
                let entry = state
                    .entry(key.clone())
                    .or_insert_with(|| SummaryAccumulator {
                        last: m.value,
                        min: m.value,
                        max: m.value,
                        best: m.value,
                        best_step: m.step,
                        count: 0,
                        direction,
                    });
                entry.last = m.value;
                entry.min = entry.min.min(m.value);
                entry.max = entry.max.max(m.value);
                // best 按指标方向:minimize 取更小,maximize 取更大
                match entry.direction {
                    MetricDirection::Minimize => {
                        if m.value < entry.best {
                            entry.best = m.value;
                            entry.best_step = m.step;
                        }
                    }
                    MetricDirection::Maximize => {
                        if m.value > entry.best {
                            entry.best = m.value;
                            entry.best_step = m.step;
                        }
                    }
                }
                entry.count += 1;

                summaries.push(SummaryRow {
                    run_id: m.run_id.clone(),
                    key: m.key.clone(),
                    context: m.context.clone(),
                    last: Some(entry.last),
                    best: Some(entry.best),
                    best_step: Some(entry.best_step),
                    min_val: Some(entry.min),
                    max_val: Some(entry.max),
                    user_val: None,
                });
            }
        }

        if !summaries.is_empty() {
            self.store.upsert_summary(&summaries).await?;
        }
        Ok(())
    }
}

// ─── SseTap ───

/// Broadcasts metric points to SSE subscribers via tokio::broadcast.
pub struct SseTap {
    sender: broadcast::Sender<SseEventData>,
}

/// A snapshot of the downsampled chart after each batch.
#[derive(Debug, Clone)]
pub struct SseEventData {
    pub run_id: String,
    pub key: String,
    pub context: String,
    pub points: Vec<(f64, f64)>, // (step, value), already LTTB'd
}

impl SseTap {
    pub fn new(sender: broadcast::Sender<SseEventData>) -> Self {
        Self { sender }
    }

    pub fn subscribe(&self) -> broadcast::Receiver<SseEventData> {
        self.sender.subscribe()
    }
}

#[async_trait::async_trait]
impl BatchTap for SseTap {
    async fn on_batch(&self, envelopes: &[Envelope]) -> StorageResult<()> {
        for env in envelopes {
            let metrics = envelope_to_metrics(env);
            // Group by (key, context)
            let mut groups: HashMap<(String, String), Vec<(f64, f64)>> = HashMap::new();
            for m in &metrics {
                groups
                    .entry((m.key.clone(), m.context.clone()))
                    .or_default()
                    .push((m.step as f64, m.value));
            }
            for ((key, context), points) in &groups {
                let sampled = lttb(points, 200); // produce ~200 points for realtime
                let _ = self.sender.send(SseEventData {
                    run_id: env.run_id.clone(),
                    key: key.clone(),
                    context: context.clone(),
                    points: sampled,
                });
            }
        }
        Ok(())
    }
}

// ─── Tests ───
#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::new_sqlite_storage;
    use std::collections::HashMap;

    fn metric_env(run_id: &str, step: i64, loss: f64, lr: f64) -> Envelope {
        let mut payload = HashMap::new();
        payload.insert("loss".into(), serde_json::json!(loss));
        payload.insert("lr".into(), serde_json::json!(lr));
        Envelope {
            kind: "metric".into(),
            run_id: run_id.into(),
            step,
            wall_time: step as f64,
            context: String::new(),
            payload,
        }
    }

    #[tokio::test]
    async fn summary_tap_tracks_last_min_max() {
        let store = new_sqlite_storage("sqlite::memory:").await.unwrap();
        let tap = SummaryTap::new(store.clone());

        // Register a run first
        tap.store
            .upsert_run(&crate::domain::RunMeta {
                run_id: "s1".into(),
                project: "test".into(),
                group_name: None,
                name: None,
                state: "running".into(),
                config: serde_json::json!({}),
                env: serde_json::json!({}),
                git_commit: None,
                sweep_id: None,
                created_at: 0.0,
                heartbeat_at: None,
                tags: None,
                owner_id: None,
            })
            .await
            .unwrap();

        // Batch 1: loss=1.0, 0.5, 0.2
        let batch = vec![
            metric_env("s1", 0, 1.0, 0.01),
            metric_env("s1", 1, 0.5, 0.01),
            metric_env("s1", 2, 0.2, 0.01),
        ];
        tap.on_batch(&batch).await.unwrap();

        let summaries = store.get_summary(&["s1".into()]).await.unwrap();
        let loss_summary = summaries.iter().find(|s| s.key == "loss").unwrap();
        assert_eq!(loss_summary.last.unwrap(), 0.2);
        assert_eq!(loss_summary.min_val.unwrap(), 0.2);
        assert_eq!(loss_summary.max_val.unwrap(), 1.0);
        assert_eq!(loss_summary.best.unwrap(), 0.2);
    }

    #[test]
    fn infer_direction_heuristics() {
        assert_eq!(infer_direction("loss"), MetricDirection::Minimize);
        assert_eq!(infer_direction("train/loss"), MetricDirection::Minimize);
        assert_eq!(infer_direction("accuracy"), MetricDirection::Maximize);
        assert_eq!(
            infer_direction("my_custom_score"),
            MetricDirection::Maximize
        );
        assert_eq!(infer_direction("auc"), MetricDirection::Maximize);
        assert_eq!(infer_direction("weird_metric"), MetricDirection::Minimize);
    }

    #[tokio::test]
    async fn summary_tap_best_respects_maximize_direction() {
        let store = new_sqlite_storage("sqlite::memory:").await.unwrap();
        let tap = SummaryTap::new(store.clone());

        // run config 显式声明 accuracy=max(覆盖命名约定)
        store
            .upsert_run(&crate::domain::RunMeta {
                run_id: "s2".into(),
                project: "test".into(),
                group_name: None,
                name: None,
                state: "running".into(),
                config: serde_json::json!({"metric_directions": {"accuracy": "max"}}),
                env: serde_json::json!({}),
                git_commit: None,
                sweep_id: None,
                created_at: 0.0,
                heartbeat_at: None,
                tags: None,
                owner_id: None,
            })
            .await
            .unwrap();

        // accuracy 递增再回落:0.5 → 0.9 → 0.7,best 应为 0.9
        for (step, v) in [(0i64, 0.5f64), (1, 0.9), (2, 0.7)] {
            let mut payload = HashMap::new();
            payload.insert("accuracy".into(), serde_json::json!(v));
            let env = Envelope {
                kind: "metric".into(),
                run_id: "s2".into(),
                step,
                wall_time: step as f64,
                context: String::new(),
                payload,
            };
            tap.on_batch(&[env]).await.unwrap();
        }

        let got = store.get_summary(&["s2".into()]).await.unwrap();
        let acc = got.iter().find(|s| s.key == "accuracy").unwrap();
        assert_eq!(acc.best, Some(0.9));
        assert_eq!(acc.best_step, Some(1));

        // 未声明方向的指标走约定:loss → minimize
        let mut p = HashMap::new();
        p.insert("loss".into(), serde_json::json!(0.8));
        tap.on_batch(&[Envelope {
            kind: "metric".into(),
            run_id: "s2".into(),
            step: 0,
            wall_time: 0.0,
            context: String::new(),
            payload: p,
        }])
        .await
        .unwrap();
        let mut p = HashMap::new();
        p.insert("loss".into(), serde_json::json!(0.3));
        tap.on_batch(&[Envelope {
            kind: "metric".into(),
            run_id: "s2".into(),
            step: 1,
            wall_time: 1.0,
            context: String::new(),
            payload: p,
        }])
        .await
        .unwrap();
        let got = store.get_summary(&["s2".into()]).await.unwrap();
        let loss = got.iter().find(|s| s.key == "loss").unwrap();
        assert_eq!(loss.best, Some(0.3));
        assert_eq!(loss.best_step, Some(1));
    }

    #[tokio::test]
    async fn sse_tap_broadcasts_lttb_downsampled() {
        let (tx, mut rx) = broadcast::channel(2048);
        let tap = SseTap::new(tx.clone());

        // Generate 500 points
        let mut batch = Vec::new();
        for step in 0..500 {
            batch.push(metric_env("r1", step, (step as f64).sin(), 0.001));
        }
        tap.on_batch(&batch).await.unwrap();

        let event = rx.try_recv().unwrap();
        // Should be downsampled to ~200
        assert!(event.points.len() <= 200);
        assert!(!event.points.is_empty());
    }
}

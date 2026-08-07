/// Alert engine: evaluates rules on ingested batches.
///
/// Rule types:
///   - state_change: fires when a run transitions to a terminal state
///   - stuck: fires when heartbeat times out and GPU util is 0
///   - metric_threshold: fires when a metric crosses a threshold N consecutive times
use crate::domain::Envelope;
use crate::error::StorageResult;
use crate::ingest::envelope_to_metrics;
use crate::taps::BatchTap;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

/// A single alert rule.
#[derive(Debug, Clone)]
pub struct AlertRule {
    pub id: String,
    pub project: Option<String>,
    pub run_id: Option<String>,
    pub kind: AlertKind,
    pub webhook_url: String,
    pub enabled: bool,
}

#[derive(Debug, Clone)]
pub enum AlertKind {
    StateChange,
    Stuck {
        timeout_secs: f64,
        gpu_util_threshold: f64,
    },
    MetricThreshold {
        metric_key: String,
        op: ThresholdOp,
        threshold: f64,
        consecutive_count: usize,
    },
}

#[derive(Debug, Clone, Copy)]
pub enum ThresholdOp {
    Gt,
    Lt,
}

/// An alert event that was triggered.
#[derive(Debug, Clone)]
pub struct AlertEvent {
    pub rule_id: String,
    pub run_id: String,
    pub message: String,
    pub timestamp: f64,
}

/// AlertTap evaluates rules on every batch and emits events.
pub struct AlertTap {
    rules: Arc<Mutex<Vec<AlertRule>>>,
    /// Per-rule, per-run consecutive hit counter for metric_threshold rules.
    counters: Mutex<HashMap<(String, String), usize>>,
    /// Callback to notify external systems.
    on_alert: Arc<dyn Fn(AlertEvent) + Send + Sync>,
}

impl AlertTap {
    pub fn new(
        rules: Vec<AlertRule>,
        on_alert: impl Fn(AlertEvent) + Send + Sync + 'static,
    ) -> Self {
        Self {
            rules: Arc::new(Mutex::new(rules)),
            counters: Mutex::new(HashMap::new()),
            on_alert: Arc::new(on_alert),
        }
    }

    /// Hot-reload rules at runtime.
    pub async fn update_rules(&self, rules: Vec<AlertRule>) {
        *self.rules.lock().await = rules;
    }
}

#[async_trait::async_trait]
impl BatchTap for AlertTap {
    async fn on_batch(&self, envelopes: &[Envelope]) -> StorageResult<()> {
        let rules = self.rules.lock().await;
        let mut counters = self.counters.lock().await;

        for rule in rules.iter().filter(|r| r.enabled) {
            match &rule.kind {
                AlertKind::MetricThreshold {
                    metric_key,
                    op,
                    threshold,
                    consecutive_count,
                } => {
                    for env in envelopes {
                        let metrics = envelope_to_metrics(env);
                        for m in &metrics {
                            if m.key != *metric_key {
                                continue;
                            }
                            let triggered = match op {
                                ThresholdOp::Gt => m.value > *threshold,
                                ThresholdOp::Lt => m.value < *threshold,
                            };

                            let counter_key = (rule.id.clone(), m.run_id.clone());
                            if triggered {
                                let count = counters.entry(counter_key.clone()).or_insert(0);
                                *count += 1;
                                if *count >= *consecutive_count {
                                    (self.on_alert)(AlertEvent {
                                        rule_id: rule.id.clone(),
                                        run_id: m.run_id.clone(),
                                        message: format!(
                                            "Metric {} {} {} for {} consecutive steps (current: {})",
                                            metric_key, op_label(*op), threshold, consecutive_count, m.value
                                        ),
                                        timestamp: m.wall_time,
                                    });
                                    counters.remove(&counter_key);
                                }
                            } else {
                                counters.remove(&counter_key);
                            }
                        }
                    }
                }
                _ => {} // StateChange/Stuck handled by RunManager.check_timeouts
            }
        }
        Ok(())
    }
}

fn op_label(op: ThresholdOp) -> &'static str {
    match op {
        ThresholdOp::Gt => ">",
        ThresholdOp::Lt => "<",
    }
}

// ─── Tests ───
#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    use std::sync::Mutex as StdMutex;

    fn make_metric_env(run_id: &str, step: i64, key: &str, value: f64) -> Envelope {
        let mut payload = HashMap::new();
        payload.insert(key.into(), serde_json::json!(value));
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
    async fn metric_threshold_fires_after_consecutive_hits() {
        let events = Arc::new(StdMutex::new(Vec::new()));
        let events_clone = events.clone();

        let rule = AlertRule {
            id: "r1".into(),
            project: None,
            run_id: None,
            kind: AlertKind::MetricThreshold {
                metric_key: "loss".into(),
                op: ThresholdOp::Gt,
                threshold: 10.0,
                consecutive_count: 3,
            },
            webhook_url: "http://example.com".into(),
            enabled: true,
        };

        let tap = AlertTap::new(vec![rule], move |event| {
            events_clone.lock().unwrap().push(event);
        });

        // Batch 1: loss=12, 15 — 2 consecutive hits (not enough)
        let batch = vec![
            make_metric_env("r1", 1, "loss", 12.0),
            make_metric_env("r1", 2, "loss", 15.0),
        ];
        tap.on_batch(&batch).await.unwrap();
        assert!(events.lock().unwrap().is_empty());

        // Batch 2: loss=20 — 3rd hit, triggers alert
        let batch2 = vec![make_metric_env("r1", 3, "loss", 20.0)];
        tap.on_batch(&batch2).await.unwrap();

        let alerts = events.lock().unwrap();
        assert_eq!(alerts.len(), 1);
        assert_eq!(alerts[0].rule_id, "r1");
        assert!(alerts[0].message.contains("loss"));
    }

    #[tokio::test]
    async fn counter_resets_on_non_triggering_value() {
        let events = Arc::new(StdMutex::new(Vec::new()));
        let ec = events.clone();

        let rule = AlertRule {
            id: "r2".into(),
            project: None,
            run_id: None,
            kind: AlertKind::MetricThreshold {
                metric_key: "loss".into(),
                op: ThresholdOp::Gt,
                threshold: 10.0,
                consecutive_count: 2,
            },
            webhook_url: "".into(),
            enabled: true,
        };

        let tap = AlertTap::new(vec![rule], move |e| {
            ec.lock().unwrap().push(e);
        });

        // Hit 1: loss=11
        tap.on_batch(&[make_metric_env("r1", 1, "loss", 11.0)])
            .await
            .unwrap();
        // Non-hit: loss=5 (resets counter)
        tap.on_batch(&[make_metric_env("r1", 2, "loss", 5.0)])
            .await
            .unwrap();
        // Hit 1 again (counter reset): loss=12
        tap.on_batch(&[make_metric_env("r1", 3, "loss", 12.0)])
            .await
            .unwrap();

        assert!(
            events.lock().unwrap().is_empty(),
            "should not fire — counter reset"
        );
    }
}

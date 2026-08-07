/// Run lifecycle manager — tracks run states and heartbeats.
/// Runs are a finite state machine: running → finished | crashed | killed.
use crate::domain::RunMeta;
use crate::error::StorageResult;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

/// Valid run states
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RunState {
    Running,
    Finished,
    Crashed,
    Killed,
}

impl RunState {
    pub fn as_str(&self) -> &'static str {
        match self {
            RunState::Running => "running",
            RunState::Finished => "finished",
            RunState::Crashed => "crashed",
            RunState::Killed => "killed",
        }
    }

    /// Allowed transitions from this state
    pub fn can_transition_to(&self, target: RunState) -> bool {
        match (self, target) {
            (RunState::Running, _) => true,   // running can go anywhere
            (RunState::Finished, _) => false, // terminal
            (RunState::Crashed, _) => false,  // terminal
            (RunState::Killed, _) => false,   // terminal
        }
    }

    pub fn is_terminal(&self) -> bool {
        matches!(
            self,
            RunState::Finished | RunState::Crashed | RunState::Killed
        )
    }
}

/// Run lifecycle manager: handles state transitions and heartbeat checks.
pub struct RunManager {
    heartbeat_timeout: Duration,
    store: Arc<dyn crate::storage::Storage>,
}

impl RunManager {
    pub fn new(store: Arc<dyn crate::storage::Storage>, heartbeat_timeout: Duration) -> Self {
        Self {
            heartbeat_timeout,
            store,
        }
    }

    /// Register a new run (state = running)
    pub async fn register_run(&self, mut run: RunMeta) -> StorageResult<()> {
        run.state = "running".into();
        let now = now_ts();
        run.created_at = now;
        if run.heartbeat_at.is_none() {
            run.heartbeat_at = Some(now);
        }
        self.store.upsert_run(&run).await
    }

    /// Update heartbeat for an active run
    pub async fn heartbeat(&self, run_id: &str) -> StorageResult<()> {
        self.store.heartbeat(run_id, now_ts()).await
    }

    /// Mark a run as finished
    pub async fn finish_run(&self, run_id: &str) -> StorageResult<()> {
        self.transition(run_id, RunState::Finished).await
    }

    /// Mark a run as crashed (called by the timeout checker)
    pub async fn mark_crashed(&self, run_id: &str) -> StorageResult<()> {
        self.transition(run_id, RunState::Crashed).await
    }

    async fn transition(&self, run_id: &str, target: RunState) -> StorageResult<()> {
        if let Some(run) = self.store.get_run(run_id).await? {
            let current = parse_state(&run.state);
            if current.can_transition_to(target) {
                let mut updated = run;
                updated.state = target.as_str().into();
                self.store.upsert_run(&updated).await?;
            }
        }
        Ok(())
    }

    /// Check all running runs for heartbeat timeout
    pub async fn check_timeouts(&self) -> StorageResult<usize> {
        let filter = crate::domain::RunFilter {
            state: Some("running".into()),
            ..Default::default()
        };
        let runs = self.store.list_runs(&filter).await?;
        let now = now_ts();
        let mut crashed_count = 0;

        for run in &runs {
            if let Some(last_hb) = run.heartbeat_at {
                if now - last_hb > self.heartbeat_timeout.as_secs_f64() {
                    tracing::warn!(run_id = %run.run_id, "run marked crashed: heartbeat timeout");
                    self.mark_crashed(&run.run_id).await?;
                    crashed_count += 1;
                }
            }
        }
        Ok(crashed_count)
    }
}

fn parse_state(s: &str) -> RunState {
    match s {
        "finished" => RunState::Finished,
        "crashed" => RunState::Crashed,
        "killed" => RunState::Killed,
        _ => RunState::Running,
    }
}

fn now_ts() -> f64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs_f64()
}

// ─── Tests ───
#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::new_sqlite_storage;

    async fn setup() -> RunManager {
        let store = new_sqlite_storage("sqlite::memory:").await.unwrap();
        RunManager::new(store, Duration::from_secs(2))
    }

    fn test_run(id: &str) -> RunMeta {
        RunMeta {
            run_id: id.into(),
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
        }
    }

    #[tokio::test]
    async fn register_run_sets_state_to_running() {
        let mgr = setup().await;
        mgr.register_run(test_run("r1")).await.unwrap();
        let run = mgr.store.get_run("r1").await.unwrap().unwrap();
        assert_eq!(run.state, "running");
    }

    #[tokio::test]
    async fn finish_run_transitions_to_finished() {
        let mgr = setup().await;
        mgr.register_run(test_run("r2")).await.unwrap();
        mgr.finish_run("r2").await.unwrap();
        let run = mgr.store.get_run("r2").await.unwrap().unwrap();
        assert_eq!(run.state, "finished");
    }

    #[tokio::test]
    async fn heartbeat_updates_timestamp() {
        let mgr = setup().await;
        mgr.register_run(test_run("r3")).await.unwrap();
        mgr.heartbeat("r3").await.unwrap();
        let run = mgr.store.get_run("r3").await.unwrap().unwrap();
        assert!(run.heartbeat_at.unwrap() > 1000.0);
    }

    #[tokio::test]
    async fn timeout_marks_crashed() {
        let mgr = setup().await;

        // Register a run with an old heartbeat
        let mut run = test_run("r4");
        run.heartbeat_at = Some(now_ts() - 10.0); // 10 seconds ago (timeout is 2s)
        mgr.register_run(run).await.unwrap();

        // Check timeouts
        let crashed = mgr.check_timeouts().await.unwrap();
        assert_eq!(crashed, 1);

        let run = mgr.store.get_run("r4").await.unwrap().unwrap();
        assert_eq!(run.state, "crashed");
    }

    #[tokio::test]
    async fn active_run_not_crashed() {
        let mgr = setup().await;
        mgr.register_run(test_run("r5")).await.unwrap();
        let crashed = mgr.check_timeouts().await.unwrap();
        assert_eq!(crashed, 0);
    }

    #[test]
    fn state_transition_rules() {
        assert!(RunState::Running.can_transition_to(RunState::Finished));
        assert!(RunState::Running.can_transition_to(RunState::Crashed));
        assert!(RunState::Running.can_transition_to(RunState::Killed));
        assert!(!RunState::Finished.can_transition_to(RunState::Running));
        assert!(!RunState::Crashed.can_transition_to(RunState::Running));
    }
}

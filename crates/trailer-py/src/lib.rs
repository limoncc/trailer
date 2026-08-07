use pyo3::prelude::*;
use std::sync::Arc;
use tokio::sync::mpsc;
use trailer_core::domain::{Envelope, FigureRow, RunMeta, TableRow, TextRow};
use trailer_core::ingest::run_ingestion_writer_with_taps;
use trailer_core::storage::{new_file_storage, new_sqlite_storage};
use trailer_core::system_monitor::HardwareSample;
use trailer_core::taps::SummaryTap;

/// Python-facing Rust tracker. Handles ingestion directly (no HTTP).
#[pyclass]
struct RustTracker {
    tx: Arc<mpsc::Sender<Vec<Envelope>>>,
    store: Arc<dyn trailer_core::Storage>,
    _rt: tokio::runtime::Runtime,
}

#[pymethods]
impl RustTracker {
    #[new]
    #[pyo3(signature = (db_path, storage=None, data_dir=None))]
    fn new(db_path: String, storage: Option<String>, data_dir: Option<String>) -> PyResult<Self> {
        let rt = tokio::runtime::Runtime::new()
            .map_err(|e| pyo3::exceptions::PyRuntimeError::new_err(e.to_string()))?;

        let store = rt
            .block_on(async {
                match storage.as_deref() {
                    // 文件模式：TensorBoard 风格 data/[project]/[run_id]/ 目录树
                    Some("file") => {
                        let root = data_dir.unwrap_or_else(|| "data".to_string());
                        new_file_storage(&root).await
                    }
                    // 默认 / "sqlite"：SQLite 数据库
                    _ => new_sqlite_storage(&db_path).await,
                }
            })
            .map_err(|e| pyo3::exceptions::PyRuntimeError::new_err(e.to_string()))?;

        let (tx, rx) = mpsc::channel::<Vec<Envelope>>(10_000);
        let tx = Arc::new(tx);

        let writer_store = store.clone();
        let summary_store = store.clone();
        rt.spawn(async move {
            run_ingestion_writer_with_taps(
                rx,
                writer_store,
                vec![Box::new(SummaryTap::new(summary_store))],
            )
            .await;
        });

        Ok(RustTracker { tx, store, _rt: rt })
    }

    /// Accept msgpack bytes of Vec<Envelope>, push to ingestion channel.
    fn log_batch(&self, batch_bytes: &[u8]) -> PyResult<()> {
        let batch: Vec<Envelope> = rmp_serde::from_slice(batch_bytes)
            .map_err(|e| pyo3::exceptions::PyValueError::new_err(e.to_string()))?;
        self.tx
            .blocking_send(batch)
            .map_err(|e| pyo3::exceptions::PyRuntimeError::new_err(e.to_string()))?;
        Ok(())
    }

    /// Update heartbeat timestamp for an active run.
    fn heartbeat(&self, run_id: String) -> PyResult<()> {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs_f64();
        self._rt
            .block_on(self.store.heartbeat(&run_id, now))
            .map_err(|e| pyo3::exceptions::PyRuntimeError::new_err(e.to_string()))?;
        Ok(())
    }

    /// Update run state to "finished".
    fn finish_run(&self, run_id: String) -> PyResult<()> {
        if let Ok(Some(mut run)) = self._rt.block_on(self.store.get_run(&run_id)) {
            run.state = "finished".into();
            self._rt
                .block_on(self.store.upsert_run(&run))
                .map_err(|e| pyo3::exceptions::PyRuntimeError::new_err(e.to_string()))?;
        }
        Ok(())
    }

    /// Create a run entry in the runs table.
    #[pyo3(signature = (run_id, project, name, sweep_id=None, config_json=None, owner_id=None))]
    fn create_run(
        &self,
        run_id: String,
        project: String,
        name: String,
        sweep_id: Option<String>,
        config_json: Option<String>,
        owner_id: Option<i64>,
    ) -> PyResult<()> {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs_f64();
        let config = config_json
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or(serde_json::json!({}));
        let run = RunMeta {
            run_id,
            project,
            group_name: None,
            name: Some(name),
            state: "running".into(),
            config,
            env: serde_json::json!({}),
            git_commit: None,
            sweep_id,
            created_at: now,
            heartbeat_at: Some(now),
            tags: None,
            owner_id,
        };
        self._rt
            .block_on(self.store.upsert_run(&run))
            .map_err(|e| pyo3::exceptions::PyRuntimeError::new_err(e.to_string()))
    }

    /// Store a figure directly to storage.
    fn save_figure(
        &self,
        name: String,
        kind: String,
        body: String,
        step: i64,
        run_id: String,
    ) -> PyResult<()> {
        let fig = FigureRow {
            run_id,
            step,
            name,
            kind,
            body,
        };
        self._rt
            .block_on(self.store.insert_figure(&fig))
            .map_err(|e| pyo3::exceptions::PyRuntimeError::new_err(e.to_string()))?;
        Ok(())
    }

    /// Store a table directly to storage.
    fn save_table(
        &self,
        name: String,
        columns: Vec<String>,
        data_json: String,
        step: i64,
        row_count: i64,
        run_id: String,
    ) -> PyResult<()> {
        let data: serde_json::Value = serde_json::from_str(&data_json)
            .map_err(|e| pyo3::exceptions::PyValueError::new_err(e.to_string()))?;
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs_f64();
        let table = TableRow {
            id: None,
            run_id,
            step,
            name,
            columns,
            data,
            row_count,
            created_at: now,
        };
        self._rt
            .block_on(self.store.insert_table(&table))
            .map_err(|e| pyo3::exceptions::PyRuntimeError::new_err(e.to_string()))?;
        Ok(())
    }

    /// Store a text sample directly to storage.
    fn save_text(&self, run_id: String, step: i64, name: String, body: String) -> PyResult<()> {
        let text = TextRow {
            run_id,
            step,
            name,
            body,
        };
        self._rt
            .block_on(self.store.insert_texts(&[text]))
            .map_err(|e| pyo3::exceptions::PyRuntimeError::new_err(e.to_string()))?;
        Ok(())
    }

    /// Store a media file reference directly to storage.
    fn save_media(
        &self,
        name: String,
        kind: String,
        ext: String,
        file_path: String,
        size: i64,
        step: i64,
        run_id: String,
    ) -> PyResult<()> {
        use trailer_core::domain::MediaRow;
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs_f64();
        let media = MediaRow {
            id: None,
            run_id,
            step,
            name,
            kind,
            ext,
            hash: String::new(),
            file_path,
            size,
            created_at: now,
        };
        self._rt
            .block_on(self.store.insert_media(&media))
            .map_err(|e| pyo3::exceptions::PyRuntimeError::new_err(e.to_string()))?;
        Ok(())
    }
}

/// Sample hardware metrics (CPU, memory, GPU) on the current machine.
/// Returns a JSON string — Python side parses it into dicts.
#[pyfunction]
fn sample_hardware() -> PyResult<String> {
    let sample = HardwareSample::collect();
    serde_json::to_string(&sample)
        .map_err(|e| pyo3::exceptions::PyRuntimeError::new_err(e.to_string()))
}

#[pymodule]
fn trailer(_py: Python<'_>, m: &Bound<'_, PyModule>) -> PyResult<()> {
    m.add("__version__", env!("CARGO_PKG_VERSION"))?;
    m.add_class::<RustTracker>()?;
    m.add_function(wrap_pyfunction!(sample_hardware, m)?)?;
    Ok(())
}

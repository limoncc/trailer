// Trailer core: domain logic, storage abstraction, algorithms
//
// GREEN: workspace infrastructure verified (0.1)

pub mod alert;
pub mod config_diff;
pub mod domain;
pub mod downsample;
pub mod error;
pub mod expr;
pub mod ingest;
pub mod run_manager;
pub mod storage;
pub mod system_monitor;
pub mod taps;
pub mod tb_import;

// Re-export commonly used types
pub use domain::{
    ApiToken, ArtifactMeta, Envelope, FigureRow, MediaRow, MetricQuery, MetricRow, ReportRow,
    RunFilter, RunMeta, ShareInfo, ShareRow, SummaryRow, TableRow, UserRow,
};
pub use error::{StorageError, StorageResult};
pub use storage::Storage;

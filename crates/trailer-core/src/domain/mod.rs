use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use ts_rs::TS;

/// A single scalar metric data point recorded during training.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct MetricRow {
    pub run_id: String,
    pub step: i64,
    pub wall_time: f64,
    pub key: String,
    pub context: String,
    pub value: f64,
}

/// A single histogram data point — bucket counts for a value distribution at one step.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct HistogramRow {
    pub run_id: String,
    pub step: i64,
    pub wall_time: f64,
    pub key: String,
    pub context: String,
    /// Upper bounds for each bucket (length N). First bucket extends from -inf.
    pub bucket_limits: Vec<f64>,
    /// Per-bucket counts (length N). For cumulative TB data, diff is applied at ingestion.
    pub bucket_counts: Vec<i64>,
    pub min: f64,
    pub max: f64,
    /// Total number of values in the distribution.
    pub num: i64,
    /// Sum of all values.
    pub sum: f64,
    /// Sum of squared values (used for std computation).
    pub sum_squares: f64,
}

/// Top-level metadata for a tracked run.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct RunMeta {
    pub run_id: String,
    pub project: String,
    pub group_name: Option<String>,
    pub name: Option<String>,
    pub state: String,
    pub config: serde_json::Value,
    pub env: serde_json::Value,
    pub git_commit: Option<String>,
    pub sweep_id: Option<String>,
    pub created_at: f64,
    pub heartbeat_at: Option<f64>,
    pub tags: Option<Vec<String>>,
    /// 归属用户(本地模式强制 1 = admin;None = 未归属/系统内部)。
    pub owner_id: Option<i64>,
}

/// Summary statistics for a single (run, key, context) tuple.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SummaryRow {
    pub run_id: String,
    pub key: String,
    pub context: String,
    pub last: Option<f64>,
    pub best: Option<f64>,
    pub best_step: Option<i64>,
    pub min_val: Option<f64>,
    pub max_val: Option<f64>,
    pub user_val: Option<f64>,
}

/// Filters for listing runs.
#[derive(Debug, Clone, Default, TS)]
#[ts(export)]
pub struct RunFilter {
    pub project: Option<String>,
    pub state: Option<String>,
    pub sweep_id: Option<String>,
    pub expr: Option<String>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
    /// None = 不过滤(admin/后台全量);Some(id) = 只看该用户自己拥有的 run。
    pub owner_id: Option<i64>,
}

/// Query parameters for fetching metrics.
#[derive(Debug, Clone, Default)]
pub struct MetricQuery {
    pub run_id: Option<String>,
    pub key: Option<String>,
    pub context: Option<String>,
    pub after_step: Option<i64>,
    pub max_points: Option<usize>,
    /// If true, the storage should apply LTTB downsampling.
    pub downsample: bool,
}

/// Query parameters for listing runs (supports summary join for sorting).
#[derive(Debug, Clone, Default)]
pub struct RunListQuery {
    pub filter: RunFilter,
    pub order_by: Option<String>, // e.g. "summary/loss:best desc"
    pub limit: i64,
    pub offset: i64,
}

/// Generic batch of envelopes — the common ingestion format.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Envelope {
    pub kind: String,
    pub run_id: String,
    pub step: i64,
    pub wall_time: f64,
    pub context: String,
    pub payload: HashMap<String, serde_json::Value>,
}

/// A text sample (LLM generation, prompt/response, transcript).
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct TextRow {
    pub run_id: String,
    pub step: i64,
    pub name: String,
    pub body: String,
}
/// A recorded figure — PNG or G2 chart spec.
/// Stored body is base64-encoded PNG bytes or JSON G2 spec.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FigureRow {
    pub run_id: String,
    pub step: i64,
    pub name: String,
    pub kind: String, // "png" | "g2"
    pub body: String, // base64 for png, JSON for g2
}

/// A Markdown report with live metric references.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReportRow {
    pub id: Option<String>,
    #[serde(default)]
    pub owner_id: Option<i64>,
    pub project: String,
    pub title: String,
    pub body: String,
    pub created_at: f64,
}

/// A saved Explore analysis workspace (selected runs + chart definitions).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExploreRow {
    pub id: Option<String>,
    pub owner_id: i64,
    pub project: String,
    pub title: String,
    pub description: String,
    /// JSON array of run_id strings
    pub run_ids: String,
    /// JSON array of ChartDef
    pub chart_defs: String,
    /// JSON object (e.g. { "columns": 2 })
    pub config: String,
    pub created_at: f64,
    pub updated_at: f64,
}

/// A registered user.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserRow {
    pub id: Option<i64>,
    pub username: String,
    pub password: String, // SHA-256 hex
    pub role: String,     // "experimenter" | "admin"
    pub created_at: f64,
    /// 用户主题偏好(JSON: { name?, isDark, vars? }),空为默认
    #[serde(default = "default_theme_json")]
    pub theme: String,
}

fn default_theme_json() -> String {
    "{}".into()
}

/// A share — grants another user access to a resource.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShareRow {
    pub id: Option<i64>,
    pub owner_id: i64,
    pub shared_with_id: i64,
    pub resource_type: String,
    pub resource_id: String,
    pub created_at: f64,
}

/// 匿名共享记录(token 型)— 用于共享管理列表。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShareInfo {
    pub token: String,
    pub resource_type: String,
    pub resource_id: String,
    pub created_at: f64,
    pub expires_at: Option<f64>,
}

/// 持久化 API token — 用户认证凭证(数据库存储,可设有效期)。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApiToken {
    pub token: String,
    pub user_id: i64,
    pub name: Option<String>,
    pub created_at: f64,
    pub expires_at: Option<f64>,
}

/// A logged table — tabular data stored as JSON columns + rows.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TableRow {
    pub id: Option<i64>,
    pub run_id: String,
    pub step: i64,
    pub name: String,
    pub columns: Vec<String>,
    pub data: serde_json::Value, // array of arrays: [[val,...],...]
    pub row_count: i64,
    pub created_at: f64,
}

/// A media file stored on disk with metadata in DB.
/// Large files (video/audio) are stored on disk, images can be base64 in body.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MediaRow {
    pub id: Option<i64>,
    pub run_id: String,
    pub step: i64,
    pub name: String,
    pub kind: String,      // "image" | "video" | "audio"
    pub ext: String,       // "png" | "jpg" | "mp4" | "mp3" | ...
    pub hash: String,      // SHA256 hex
    pub file_path: String, // relative path in artifacts dir
    pub size: i64,
    pub created_at: f64,
}

/// Artifact metadata (stub for now).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArtifactMeta {
    pub id: Option<i64>,
    pub run_id: String,
    pub step: i64,
    pub name: String,
    pub kind: String,
    pub hash: String,
    pub rel_path: String,
    pub size: i64,
    pub created_at: f64,
}

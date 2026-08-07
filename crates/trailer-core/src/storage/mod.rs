pub mod file;
pub mod sqlite;

#[cfg(feature = "pg")]
pub mod postgres;

use crate::domain::{
    ApiToken, ArtifactMeta, ExploreRow, FigureRow, HistogramRow, MediaRow, MetricQuery, MetricRow,
    ReportRow, RunFilter, RunMeta, ShareInfo, SummaryRow, TableRow, TextRow, UserRow,
};
use crate::error::StorageResult;
use async_trait::async_trait;
use std::sync::Arc;

/// Core storage abstraction — one trait, two backends (SQLite, PostgreSQL).
/// Contract tests run against both implementations via the `storage_contract_tests!` macro.
#[async_trait]
pub trait Storage: Send + Sync {
    // ── Metrics ──
    async fn insert_metrics(&self, records: &[MetricRow]) -> StorageResult<()>;
    async fn query_metrics(&self, q: &MetricQuery) -> StorageResult<Vec<MetricRow>>;
    async fn get_max_step(&self, run_id: &str) -> StorageResult<Option<i64>>;
    async fn delete_metrics_for_run(&self, run_id: &str) -> StorageResult<()>;

    // ── Histograms ──
    async fn insert_histograms(&self, records: &[HistogramRow]) -> StorageResult<()>;
    async fn query_histograms(
        &self,
        run_id: &str,
        key: Option<&str>,
        context: Option<&str>,
    ) -> StorageResult<Vec<HistogramRow>>;
    async fn delete_histograms_for_run(&self, run_id: &str) -> StorageResult<()>;

    // ── Runs ──
    async fn upsert_run(&self, run: &RunMeta) -> StorageResult<()>;
    async fn list_runs(&self, filter: &RunFilter) -> StorageResult<Vec<RunMeta>>;
    async fn count_runs(&self, filter: &RunFilter) -> StorageResult<u64>;
    async fn get_run(&self, run_id: &str) -> StorageResult<Option<RunMeta>>;
    async fn heartbeat(&self, run_id: &str, ts: f64) -> StorageResult<()>;
    async fn delete_run(&self, run_id: &str) -> StorageResult<()>;

    // ── Project Ownership ──
    /// 项目 owner = 该项目下第一个 run 的 owner_id(由 runs 表推导)。
    async fn get_project_owner(&self, project: &str) -> StorageResult<Option<i64>>;

    // ── Summary ──
    async fn upsert_summary(&self, summary: &[SummaryRow]) -> StorageResult<()>;
    async fn get_summary(&self, run_ids: &[String]) -> StorageResult<Vec<SummaryRow>>;

    // ── Texts ──
    async fn insert_texts(&self, texts: &[TextRow]) -> StorageResult<()>;
    async fn query_texts(
        &self,
        run_id: &str,
        name: &str,
        after_step: Option<i64>,
    ) -> StorageResult<Vec<TextRow>>;

    // ── Figures ──
    async fn insert_figure(&self, fig: &FigureRow) -> StorageResult<()>;
    async fn query_figures(
        &self,
        run_id: &str,
        name: Option<&str>,
    ) -> StorageResult<Vec<FigureRow>>;

    // ── Users ──
    async fn insert_user(&self, user: &UserRow) -> StorageResult<i64>;
    async fn get_user_by_username(&self, username: &str) -> StorageResult<Option<UserRow>>;
    async fn get_user_by_id(&self, id: i64) -> StorageResult<Option<UserRow>>;
    async fn list_users(
        &self,
        limit: Option<i64>,
        offset: Option<i64>,
    ) -> StorageResult<Vec<UserRow>>;
    async fn count_users(&self) -> StorageResult<u64>;
    async fn update_user_role(&self, id: i64, role: &str) -> StorageResult<()>;
    async fn update_user_password(&self, id: i64, password: &str) -> StorageResult<()>;
    async fn delete_user(&self, id: i64) -> StorageResult<()>;
    /// 用户主题偏好(JSON)
    async fn get_user_theme(&self, user_id: i64) -> StorageResult<String>;
    async fn update_user_theme(&self, user_id: i64, theme_json: &str) -> StorageResult<()>;

    // ── Reports ──
    async fn insert_report(&self, report: &ReportRow) -> StorageResult<String>;
    async fn update_report(&self, id: &str, title: &str, body: &str) -> StorageResult<()>;
    async fn delete_report(&self, id: &str) -> StorageResult<()>;
    async fn list_reports(
        &self,
        project: Option<&str>,
        owner_id: Option<i64>,
        limit: Option<i64>,
        offset: Option<i64>,
    ) -> StorageResult<Vec<ReportRow>>;
    async fn count_reports(&self, project: Option<&str>, owner_id: Option<i64>) -> StorageResult<u64>;
    async fn delete_runs_by_project(&self, project: &str) -> StorageResult<usize>;
    async fn get_report(&self, id: &str) -> StorageResult<Option<ReportRow>>;

    // ── Explores (saved analysis workspaces) ──
    async fn insert_explore(&self, explore: &ExploreRow) -> StorageResult<String>;
    async fn update_explore(
        &self,
        id: &str,
        title: &str,
        description: &str,
        run_ids: &str,
        chart_defs: &str,
        config: &str,
    ) -> StorageResult<()>;
    async fn delete_explore(&self, id: &str) -> StorageResult<()>;
    async fn list_explores(
        &self,
        owner_id: i64,
        project: Option<&str>,
        limit: Option<i64>,
        offset: Option<i64>,
    ) -> StorageResult<Vec<ExploreRow>>;
    async fn count_explores(&self, owner_id: i64, project: Option<&str>) -> StorageResult<u64>;
    async fn get_explore(&self, id: &str) -> StorageResult<Option<ExploreRow>>;

    // ── Tables ──
    async fn insert_table(&self, table: &TableRow) -> StorageResult<i64>;
    async fn query_tables(&self, run_id: &str, name: Option<&str>) -> StorageResult<Vec<TableRow>>;
    async fn get_table_by_id(&self, id: i64) -> StorageResult<Option<TableRow>>;

    // ── Media ──
    async fn insert_media(&self, media: &MediaRow) -> StorageResult<i64>;
    async fn query_media(&self, run_id: &str, kind: Option<&str>) -> StorageResult<Vec<MediaRow>>;
    async fn get_media_by_id(&self, id: i64) -> StorageResult<Option<MediaRow>>;

    // ── Artifacts ──
    async fn insert_artifact(&self, meta: &ArtifactMeta) -> StorageResult<()>;

    // ── Shares ──
    async fn create_share(
        &self,
        token: &str,
        resource_type: &str,
        resource_id: &str,
        expires_at: Option<f64>,
    ) -> StorageResult<()>;
    async fn get_share(&self, token: &str) -> StorageResult<Option<(String, String, Option<f64>)>>;
    async fn list_shares(
        &self,
        limit: Option<i64>,
        offset: Option<i64>,
    ) -> StorageResult<Vec<ShareInfo>>;
    async fn count_shares(&self) -> StorageResult<u64>;
    async fn delete_share(&self, token: &str) -> StorageResult<()>;
    async fn update_share_expiry(&self, token: &str, expires_at: Option<f64>) -> StorageResult<()>;
    async fn delete_expired_shares(&self) -> StorageResult<usize>;

    // ── API Tokens(持久化认证)──
    async fn create_api_token(
        &self,
        token: &str,
        user_id: i64,
        name: Option<&str>,
        expires_at: Option<f64>,
    ) -> StorageResult<()>;
    async fn list_api_tokens(&self, user_id: i64) -> StorageResult<Vec<ApiToken>>;
    async fn delete_api_token(&self, token: &str) -> StorageResult<()>;
    /// 按名称删除 API token(用于清理历史 login 记录)。
    async fn delete_api_tokens_by_name(&self, name: &str) -> StorageResult<usize>;
    async fn update_api_token_expiry(
        &self,
        token: &str,
        expires_at: Option<f64>,
    ) -> StorageResult<()>;
    /// 按 token 查用户(JOIN users + 过期检查);None = 无效/过期。
    async fn get_user_by_api_token(&self, token: &str) -> StorageResult<Option<UserRow>>;
}

/// Helper to construct storage instances. Allows test code to be backend-agnostic.
pub async fn new_sqlite_storage(path: &str) -> StorageResult<Arc<dyn Storage>> {
    let store = crate::storage::sqlite::SqliteStorage::open(path).await?;
    Ok(Arc::new(store))
}

/// 文件模式存储(本地目录,TensorBoard 风格)。
pub async fn new_file_storage(root: &str) -> StorageResult<Arc<dyn Storage>> {
    let store = crate::storage::file::FileStorage::open(root).await?;
    Ok(Arc::new(store))
}

#[cfg(feature = "pg")]
pub async fn new_pg_storage(url: &str) -> StorageResult<Arc<dyn Storage>> {
    use crate::storage::postgres::PgStorage;
    let store = PgStorage::open(url).await?;
    Ok(Arc::new(store))
}

/// 检测 PG "database does not exist" 错误(3D000),返回错误消息。
pub fn is_database_missing_error(err: &crate::error::StorageError) -> Option<String> {
    if let crate::error::StorageError::Database(sqlx::Error::Database(db_err)) = err {
        if db_err.code().as_deref() == Some("3D000") {
            return Some(db_err.message().to_string());
        }
    }
    None
}

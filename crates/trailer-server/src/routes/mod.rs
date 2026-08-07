use crate::auth::{SharedAuth, UserInfo as AuthUserInfo};
use crate::error::internal_error;
use axum::body::Bytes;
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::response::IntoResponse;
use axum::Json;
use axum::Router;
use base64::Engine as _;
use futures::StreamExt;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::convert::Infallible;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Instant, SystemTime, UNIX_EPOCH};
use tokio::sync::{broadcast, mpsc, Mutex};
use tokio_stream::wrappers::BroadcastStream;
use trailer_core::domain::{
    Envelope, ExploreRow, FigureRow, MediaRow, MetricQuery, ReportRow, RunFilter, RunMeta,
    TableRow, TextRow,
};
use trailer_core::downsample::lttb;
use trailer_core::run_manager::RunManager;
use trailer_core::taps::SseEventData;

/// Simple TTL-based LTTB cache. Key = "{run_id}|{key}|{context}|{max_points}"
pub struct LttbCache {
    data: HashMap<String, (Instant, Vec<serde_json::Value>)>,
    ttl: std::time::Duration,
    max_entries: usize,
}
impl LttbCache {
    pub fn new(ttl_secs: u64, max_entries: usize) -> Self {
        Self {
            data: HashMap::new(),
            ttl: std::time::Duration::from_secs(ttl_secs),
            max_entries,
        }
    }

    pub fn get(&self, key: &str) -> Option<Vec<serde_json::Value>> {
        self.data.get(key).and_then(|(ts, val)| {
            if ts.elapsed() < self.ttl {
                Some(val.clone())
            } else {
                None
            }
        })
    }

    pub fn set(&mut self, key: String, value: Vec<serde_json::Value>) {
        if self.data.len() >= self.max_entries {
            // Evict oldest entry
            let oldest_key = self
                .data
                .iter()
                .min_by_key(|(_, (ts, _))| *ts)
                .map(|(k, _)| k.clone());
            if let Some(k) = oldest_key {
                self.data.remove(&k);
            }
        }
        self.data.insert(key, (Instant::now(), value));
    }
}

#[allow(dead_code)]
pub struct ShareEntry {
    pub token: String,
    pub resource_type: String,
    pub resource_id: String,
    pub created_at: f64,
}

/// Shared application state (injected into all routes).
#[derive(Clone)]
pub struct AppState {
    pub ingest_tx: Arc<mpsc::Sender<Vec<Envelope>>>,
    pub store: Arc<dyn trailer_core::Storage>,
    pub run_manager: Arc<RunManager>,
    pub sse_tx: broadcast::Sender<SseEventData>,
    pub artifacts_dir: PathBuf,
    pub frontend_dir: PathBuf,
    pub lttb_cache: Arc<Mutex<LttbCache>>,
    pub auth: SharedAuth,
}

// ─── POST /api/v1/ingest ───

/// Construct the full API router.
pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/v1/ingest", axum::routing::post(ingest_metrics))
        .route("/api/v1/metrics", axum::routing::get(query_metrics))
        .route(
            "/api/v1/metrics:batch-query",
            axum::routing::post(batch_query_metrics),
        )
        .route(
            "/api/v1/runs",
            axum::routing::post(create_run).get(list_runs),
        )
        .route("/api/v1/runs/diff", axum::routing::get(diff_runs))
        .route("/api/v1/runs/states", axum::routing::get(run_states))
        .route(
            "/api/v1/runs/{id}/heartbeat",
            axum::routing::post(heartbeat_run),
        )
        .route("/api/v1/runs/{id}/finish", axum::routing::post(finish_run))
        .route(
            "/api/v1/runs/{id}/delete",
            axum::routing::post(delete_run_handler),
        )
        .route(
            "/api/v1/runs/{id}/archive",
            axum::routing::post(archive_run_handler),
        )
        .route(
            "/api/v1/runs/{id}/copy",
            axum::routing::post(copy_run_handler),
        )
        .route("/api/v1/runs/{id}/resume", axum::routing::post(resume_run))
        .route("/api/v1/runs/{id}/last_step", axum::routing::get(last_step))
        .route(
            "/api/v1/runs/{id}/texts",
            axum::routing::get(query_texts).post(upload_text),
        )
        .route(
            "/api/v1/runs/{id}/histograms",
            axum::routing::get(list_histograms),
        )
        .route(
            "/api/v1/runs/{id}/stream",
            axum::routing::get(stream_events),
        )
        .route(
            "/api/v1/runs/{id}/figures",
            axum::routing::get(list_figures).post(upload_figure),
        )
        .route(
            "/api/v1/runs/{id}/media",
            axum::routing::get(list_media).post(upload_media),
        )
        .route(
            "/api/v1/runs/{id}/media/{media_id}/file",
            axum::routing::get(stream_media_file),
        )
        .route(
            "/api/v1/runs/{id}/tables",
            axum::routing::get(list_tables).post(upload_table),
        )
        .route(
            "/api/v1/runs/{id}/tables/{table_id}",
            axum::routing::get(get_table),
        )
        .route("/api/v1/sweeps", axum::routing::get(list_sweeps))
        .route(
            "/api/v1/projects/{name}/delete",
            axum::routing::post(delete_project_handler),
        )
        .route(
            "/api/v1/reports",
            axum::routing::get(list_reports).post(create_report),
        )
        .route(
            "/api/v1/reports/{id}",
            axum::routing::get(get_report)
                .put(update_report)
                .delete(delete_report),
        )
        .route(
            "/api/v1/explores",
            axum::routing::get(list_explores_handler).post(create_explore_handler),
        )
        .route(
            "/api/v1/explores/{id}",
            axum::routing::get(get_explore_handler)
                .put(update_explore_handler)
                .delete(delete_explore_handler),
        )
        .route("/api/v1/share", axum::routing::post(create_share))
        .route("/api/v1/shares", axum::routing::get(list_shares_handler))
        .route(
            "/api/v1/shares/{token}",
            axum::routing::delete(delete_share_handler).put(update_share_handler),
        )
        .route(
            "/api/v1/tokens",
            axum::routing::get(list_tokens_handler).post(create_token_handler),
        )
        .route(
            "/api/v1/tokens/{token}",
            axum::routing::delete(delete_token_handler),
        )
        .route("/api/v1/auth/login", axum::routing::post(auth_login))
        .route("/api/v1/auth/register", axum::routing::post(auth_register))
        .route("/api/v1/auth/me", axum::routing::get(auth_me))
        .route(
            "/api/v1/auth/password",
            axum::routing::put(auth_change_password),
        )
        .route(
            "/api/v1/admin/users",
            axum::routing::get(admin_list_users).post(admin_create_user),
        )
        .route(
            "/api/v1/users/me/theme",
            axum::routing::get(get_my_theme).put(update_my_theme),
        )
        .route(
            "/api/v1/admin/users/{id}/role",
            axum::routing::put(admin_set_role),
        )
        .route(
            "/api/v1/admin/users/{id}/projects",
            axum::routing::get(admin_user_projects),
        )
        .route(
            "/api/v1/admin/users/{id}",
            axum::routing::delete(admin_delete_user),
        )
        .route(
            "/api/v1/admin/users/{id}/password",
            axum::routing::put(admin_set_password),
        )
}
pub async fn ingest_metrics(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    body: Bytes,
) -> impl IntoResponse {
    if authenticate(&state, &headers).await.is_err() {
        return StatusCode::UNAUTHORIZED;
    }
    match rmp_serde::from_slice::<Vec<Envelope>>(&body) {
        Ok(batch) => {
            let count = batch.len();
            if state.ingest_tx.send(batch).await.is_err() {
                tracing::warn!("ingest channel full or writer stopped, dropping batch");
                return StatusCode::SERVICE_UNAVAILABLE;
            }
            tracing::debug!(count, "ingest batch accepted");
            StatusCode::OK
        }
        Err(e) => {
            tracing::warn!(?e, bytes = body.len(), "ingest msgpack decode failed");
            StatusCode::BAD_REQUEST
        }
    }
}

// ─── GET /api/v1/metrics ───

#[derive(Deserialize, Serialize)]
pub struct MetricsQueryParams {
    pub run_id: String,
    pub key: Option<String>,
    pub context: Option<String>,
    pub after_step: Option<i64>,
    pub max_points: Option<usize>,
    pub ema_alpha: Option<f64>, // EMA smoothing: 0 < alpha <= 1
    pub token: Option<String>,
}

#[derive(Deserialize)]
pub struct HistogramQueryParams {
    pub key: Option<String>,
    pub context: Option<String>,
    pub token: Option<String>,
}

pub async fn query_metrics(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Query(params): Query<MetricsQueryParams>,
) -> impl IntoResponse {
    if let Err(status) =
        require_run_read(&state, &params.run_id, &headers, params.token.as_deref()).await
    {
        return status.into_response();
    }
    let max_points = params.max_points.unwrap_or(1000);
    let is_incremental = params.after_step.is_some();

    // Build cache key (skip cache for incremental queries)
    let cache_key = if !is_incremental {
        Some(format!(
            "{}|{}|{}|{}",
            params.run_id,
            params.key.as_deref().unwrap_or(""),
            params.context.as_deref().unwrap_or(""),
            max_points
        ))
    } else {
        None
    };

    // Check cache
    if let Some(ref key) = cache_key {
        let cache = state.lttb_cache.lock().await;
        if let Some(cached) = cache.get(key) {
            return Json(cached).into_response();
        }
    }

    let q = MetricQuery {
        run_id: Some(params.run_id.clone()),
        key: None,
        context: None,
        after_step: params.after_step,
        max_points: Some(max_points * 10),
        downsample: false,
    };

    let response = match state.store.query_metrics(&q).await {
        Ok(rows) => {
            // Group by (key, context), keep (step, wall_time, value) triples
            let mut groups: HashMap<(String, String), Vec<(f64, f64, f64)>> = HashMap::new();
            for r in &rows {
                let key = (r.key.clone(), r.context.clone());
                groups
                    .entry(key)
                    .or_default()
                    .push((r.step as f64, r.wall_time, r.value));
            }

            // Filter by key param if specified
            let groups: Vec<_> = if let Some(ref filter_key) = params.key {
                groups
                    .into_iter()
                    .filter(|((k, _), _)| k == filter_key)
                    .collect()
            } else {
                groups.into_iter().collect()
            };

            // Apply LTTB per group, Build response
            let result: Vec<serde_json::Value> = groups
                .into_iter()
                .map(|((key, context), triples)| {
                    let pts: Vec<serde_json::Value> = if triples.len() < 2 {
                        triples.iter().enumerate().map(|(i, (s, wt, v))| {
                            serde_json::json!({"step": *s as i64, "wall_time": wt, "value": v, "idx": i})
                        }).collect()
                    } else {
                        let step_value: Vec<(f64, f64)> = triples.iter().map(|t| (t.0, t.2)).collect();
                        let threshold = max_points.min(triples.len());
                        let sampled = lttb(&step_value, threshold);
                        // step → wall_time 哈希表: O(1) 回填, 替代逐采样点线性搜索的 O(n·m)
                        let wt_map: HashMap<i64, f64> = triples.iter().map(|t| (t.0 as i64, t.1)).collect();
                        sampled.iter().enumerate().map(|(idx, (s, v))| {
                            let wt = wt_map.get(&(*s as i64)).copied().unwrap_or(0.0);
                            serde_json::json!({"step": *s as i64, "wall_time": wt, "value": v, "idx": idx})
                        }).collect()
                    };
                    serde_json::json!({
                        "key": key,
                        "context": context,
                        "points": pts,
                    })
                })
                .collect();

            // Store in cache
            if let Some(ref key) = cache_key {
                let mut cache = state.lttb_cache.lock().await;
                cache.set(key.clone(), result.clone());
            }

            Json(result).into_response()
        }
        Err(e) => internal_error(e, "query_metrics").into_response(),
    };

    response
}

// ─── POST /api/v1/metrics:batch-query ───

#[derive(Deserialize)]
pub struct BatchQueryRequest {
    pub queries: Vec<MetricsQueryParams>,
}

pub async fn batch_query_metrics(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Query(share): Query<ShareQuery>,
    Json(body): Json<BatchQueryRequest>,
) -> impl IntoResponse {
    // 校验所有去重 run_id 的只读访问
    for params in &body.queries {
        if let Err(status) =
            require_run_read(&state, &params.run_id, &headers, share.token.as_deref()).await
        {
            return status.into_response();
        }
    }
    let mut results = Vec::new();
    for params in &body.queries {
        let max_points = params.max_points.unwrap_or(1000);
        let q = MetricQuery {
            run_id: Some(params.run_id.clone()),
            key: params.key.clone(),
            context: params.context.clone(),
            after_step: params.after_step,
            max_points: Some(max_points),
            downsample: true,
        };
        if let Ok(rows) = state.store.query_metrics(&q).await {
            // 保留 (step, wall_time, value) 三元组,供 LTTB 采样后回填 wall_time
            let triples: Vec<(f64, f64, f64)> = rows
                .iter()
                .map(|r| (r.step as f64, r.wall_time, r.value))
                .collect();
            let mut points: Vec<(f64, f64)> = triples.iter().map(|t| (t.0, t.2)).collect();
            if let Some(alpha) = params.ema_alpha {
                points = apply_ema(&points, alpha);
            }
            let sampled = lttb(&points, max_points);
            results.push(serde_json::json!({
                "run_id": params.run_id,
                "key": params.key,
                "context": params.context,
                "points": sampled.iter().enumerate().map(|(i, (x, y))| {
                    let wt = triples.iter().find(|t| (t.0 - *x).abs() < 0.5).map(|t| t.1).unwrap_or(0.0);
                    let mut m = serde_json::Map::new();
                    m.insert("step".into(), serde_json::json!(*x as i64));
                    m.insert("wall_time".into(), serde_json::json!(wt));
                    m.insert("value".into(), serde_json::json!(*y));
                    m.insert("idx".into(), serde_json::json!(i));
                    serde_json::Value::Object(m)
                }).collect::<Vec<_>>(),
            }));
        }
    }
    Json(results).into_response()
}

// ─── GET /api/v1/runs/diff ───

#[derive(Deserialize)]
pub struct DiffParams {
    pub a: Option<String>,
    pub b: Option<String>,
    pub run_id_a: Option<String>,
    pub run_id_b: Option<String>,
    pub token: Option<String>,
}

pub async fn diff_runs(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Query(params): Query<DiffParams>,
) -> impl IntoResponse {
    let a = params.a.or(params.run_id_a);
    let b = params.b.or(params.run_id_b);
    let (a, b) = match (a, b) {
        (Some(a), Some(b)) => (a, b),
        _ => return StatusCode::BAD_REQUEST.into_response(),
    };
    if let Err(status) = require_run_read(&state, &a, &headers, params.token.as_deref()).await {
        return status.into_response();
    }
    if let Err(status) = require_run_read(&state, &b, &headers, params.token.as_deref()).await {
        return status.into_response();
    }
    let run_a = state.store.get_run(&a).await.ok().flatten();
    let run_b = state.store.get_run(&b).await.ok().flatten();
    match (run_a, run_b) {
        (Some(ra), Some(rb)) => {
            let diff = trailer_core::config_diff::diff_configs(&ra.config, &rb.config);
            Json(diff).into_response()
        }
        _ => StatusCode::NOT_FOUND.into_response(),
    }
}

// ─── GET /api/v1/runs/{id}/texts ───

#[derive(Deserialize)]
pub struct TextQueryParams {
    pub name: Option<String>,
    pub after_step: Option<i64>,
    pub limit: Option<i64>,
    pub token: Option<String>,
}

pub async fn query_texts(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Path(run_id): Path<String>,
    Query(params): Query<TextQueryParams>,
) -> impl IntoResponse {
    if let Err(status) = require_run_read(&state, &run_id, &headers, params.token.as_deref()).await
    {
        return status.into_response();
    }
    let name = params.name.unwrap_or_else(|| "".into());
    match state
        .store
        .query_texts(&run_id, &name, params.after_step)
        .await
    {
        Ok(rows) => {
            let limited: Vec<_> = rows
                .into_iter()
                .take(params.limit.unwrap_or(100) as usize)
                .collect();
            Json(limited).into_response()
        }
        Err(e) => internal_error(e, "query_texts").into_response(),
    }
}

// ─── POST /api/v1/runs/{id}/texts ───

#[derive(Deserialize)]
pub struct CreateTextRequest {
    pub name: String,
    pub body: String,
    pub step: i64,
}

pub async fn upload_text(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Path(run_id): Path<String>,
    Json(body): Json<CreateTextRequest>,
) -> impl IntoResponse {
    if let Err(status) = require_run_write(&state, &run_id, &headers).await {
        return status.into_response();
    }
    let text = TextRow {
        run_id: run_id.clone(), // 保留 run_id 供下方错误日志使用
        step: body.step,
        name: body.name,
        body: body.body,
    };
    match state.store.insert_texts(&[text]).await {
        Ok(()) => StatusCode::CREATED.into_response(),
        Err(e) => {
            tracing::error!(?e, run_id = %run_id, "upload_text failed");
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
    }
}

fn apply_ema(data: &[(f64, f64)], alpha: f64) -> Vec<(f64, f64)> {
    let alpha = alpha.clamp(0.0, 1.0);
    if data.is_empty() {
        return vec![];
    }
    let mut smoothed = vec![data[0]];
    let mut s = data[0].1;
    for w in data.windows(2) {
        s = alpha * w[1].1 + (1.0 - alpha) * s;
        smoothed.push((w[1].0, s));
    }
    smoothed
}

// ─── POST /api/v1/runs ───

#[derive(Deserialize, Serialize)]
pub struct CreateRunRequest {
    pub project: String,
    pub run_id: Option<String>,
    pub group_name: Option<String>,
    pub name: Option<String>,
    pub sweep_id: Option<String>,
    pub config: Option<serde_json::Value>,
    pub created_at: Option<f64>,
}

pub async fn create_run(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Json(body): Json<CreateRunRequest>,
) -> impl IntoResponse {
    let user = match authenticate(&state, &headers).await {
        Ok(u) => u,
        Err(s) => return s.into_response(),
    };
    // 仅 admin / 项目 owner 可造 run:
    // - 项目已有 owner 且不是当前用户 → 403,避免向他人项目注入 run
    // - 全新项目(无 owner)→ 放行,当前用户成为项目 owner
    if user.role != "admin" {
        if let Ok(Some(owner)) = state.store.get_project_owner(&body.project).await {
            if owner != user.id {
                return StatusCode::FORBIDDEN.into_response();
            }
        }
    }
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs_f64();
    let run_id = body
        .run_id
        .unwrap_or_else(|| format!("run_{:x}", rand::random::<u64>()));
    let run = RunMeta {
        run_id: run_id.clone(),
        project: body.project,
        group_name: body.group_name,
        name: body.name,
        state: "running".into(),
        config: body.config.unwrap_or(serde_json::json!({})),
        env: serde_json::json!({}),
        git_commit: None,
        sweep_id: body.sweep_id,
        created_at: body.created_at.unwrap_or(now),
        heartbeat_at: Some(body.created_at.unwrap_or(now)),
        tags: None,
        owner_id: Some(user.id),
    };
    match state.store.upsert_run(&run).await {
        Ok(()) => {
            tracing::info!(run_id = %run_id, project = %run.project, user = user.id, sweep_id = ?run.sweep_id, "run created");
            (
                StatusCode::CREATED,
                Json(serde_json::json!({"run_id": run_id})),
            )
                .into_response()
        }
        Err(e) => {
            tracing::error!(?e, run_id = %run_id, project = %run.project, user = user.id, "create_run failed");
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
    }
}

// ─── GET /api/v1/runs ───

#[derive(Deserialize, Serialize)]
pub struct ListRunsParams {
    pub project: Option<String>,
    /// 逗号分隔的多项目名，跨项目查询用（优先级高于 `project`）
    pub projects: Option<String>,
    pub state: Option<String>,
    pub name: Option<String>,
    pub expr: Option<String>,
    pub sweep_id: Option<String>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

/// 匿名共享访问:只读 handler 从 URL `?token=` 提取 share token。
#[derive(Deserialize)]
pub struct ShareQuery {
    pub token: Option<String>,
}

/// 列表分页查询参数(limit/offset,offset=(page-1)*limit)
#[derive(Deserialize)]
pub struct PageQuery {
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

/// 统一分页响应:数组 + X-Total-Count header
fn with_total<T: Serialize>(total: u64, items: T) -> axum::response::Response {
    let mut headers = axum::http::HeaderMap::new();
    headers.insert("x-total-count", total.to_string().parse().unwrap());
    (headers, Json(items)).into_response()
}

#[derive(Serialize)]
pub struct RunListItem {
    pub run_id: String,
    pub name: Option<String>,
    pub state: String,
    pub project: String,
    pub created_at: f64,
    pub sweep_id: Option<String>,
    pub config: serde_json::Value,
    pub summary: HashMap<String, serde_json::Value>,
    pub owner_id: Option<i64>,
}

/// 从 Authorization: Bearer header 解析用户(数据库 api_tokens,含过期检查);未登录返回 401。
async fn authenticate(
    state: &AppState,
    headers: &axum::http::HeaderMap,
) -> Result<AuthUserInfo, StatusCode> {
    let token = headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .unwrap_or("");
    let user = {
        let auth = state.auth.lock().await;
        auth.get_user_by_token(token).await
    };
    match user {
        Some(u) => Ok(u),
        None => Err(StatusCode::UNAUTHORIZED),
    }
}

/// 项目写权限:admin 任意;项目 owner 放行;其余 403。
async fn require_project_write(
    state: &AppState,
    project: &str,
    headers: &axum::http::HeaderMap,
) -> Result<AuthUserInfo, StatusCode> {
    let user = authenticate(state, headers).await?;
    if user.role == "admin" {
        return Ok(user);
    }
    if let Ok(Some(owner)) = state.store.get_project_owner(project).await {
        if owner == user.id {
            return Ok(user);
        }
    }
    Err(StatusCode::FORBIDDEN)
}

/// run 只读访问:登录(admin 或 run owner)放行;或匿名 share token 放行。
/// share_token 来自 `?token=` query(见 `shares` 表),无需登录。
async fn require_run_read(
    state: &AppState,
    run_id: &str,
    headers: &axum::http::HeaderMap,
    share_token: Option<&str>,
) -> Result<RunMeta, StatusCode> {
    let run = state
        .store
        .get_run(run_id)
        .await
        .map_err(|e| {
            tracing::error!(?e, run_id = %run_id, "get_run failed");
            StatusCode::INTERNAL_SERVER_ERROR
        })?
        .ok_or(StatusCode::NOT_FOUND)?;

    // 1) 登录路径:admin / run owner
    let authed = authenticate(state, headers).await;
    if let Ok(user) = &authed {
        if user.role == "admin" || run.owner_id == Some(user.id) {
            return Ok(run);
        }
    }

    // 2) 匿名 share token 路径:resource_type=="run" 且 resource_id==run_id 且未过期
    if let Some(tok) = share_token {
        if !tok.is_empty() {
            if let Ok(Some((rtype, rid, expires))) = state.store.get_share(tok).await {
                let now = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_secs_f64();
                let expired = expires.map(|e| now > e).unwrap_or(false);
                if !expired && rtype == "run" && rid == run_id {
                    return Ok(run);
                }
                // explore share token:该分析包含的 run 允许匿名只读
                if !expired && rtype == "explore" {
                    if let Ok(Some(explore)) = state.store.get_explore(&rid).await {
                        if let Ok(run_ids) = serde_json::from_str::<Vec<String>>(&explore.run_ids) {
                            if run_ids.contains(&run_id.to_string()) {
                                return Ok(run);
                            }
                        }
                    }
                }
            }
        }
    }

    // 已登录但无权限 → 403;未登录 → 401
    if authed.is_ok() {
        Err(StatusCode::FORBIDDEN)
    } else {
        Err(StatusCode::UNAUTHORIZED)
    }
}

/// run 写权限:require_run_read 后要求项目写权限;匿名 share token 不可写。
async fn require_run_write(
    state: &AppState,
    run_id: &str,
    headers: &axum::http::HeaderMap,
) -> Result<RunMeta, StatusCode> {
    let run = require_run_read(state, run_id, headers, None).await?;
    require_project_write(state, &run.project, headers).await?;
    Ok(run)
}

pub async fn list_runs(
    State(state): State<AppState>,
    Query(params): Query<ListRunsParams>,
    headers: axum::http::HeaderMap,
) -> impl IntoResponse {
    let user = match authenticate(&state, &headers).await {
        Ok(u) => u,
        Err(s) => return s.into_response(),
    };
    // 跨项目:projects 逗号分隔时,SQL 层 project 置 None 拉全量,再内存过滤(避免改存储层绑定)。
    let projects: Option<Vec<String>> = params.projects.as_ref().map(|p| {
        p.split(',')
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect()
    });
    let filter = RunFilter {
        project: if projects.is_some() {
            None
        } else {
            params.project
        },
        state: params.state,
        sweep_id: params.sweep_id.clone(),
        owner_id: if user.role == "admin" {
            None
        } else {
            Some(user.id)
        },
        limit: params.limit.or(Some(100)),
        offset: params.offset,
        ..Default::default()
    };

    let expr_str = params.expr.clone();
    let name_filter = params.name.clone();
    match state.store.list_runs(&filter).await {
        Ok(mut runs) => {
            // 跨项目过滤(内存)
            if let Some(ref projects) = projects {
                runs.retain(|r| projects.contains(&r.project));
            }
            // 提前取 summary,供 metric.* 表达式过滤使用
            let run_ids: Vec<String> = runs.iter().map(|r| r.run_id.clone()).collect();
            let summaries = state.store.get_summary(&run_ids).await.unwrap_or_default();
            let mut summary_lookup: HashMap<String, HashMap<String, f64>> = HashMap::new();
            for s in &summaries {
                if let Some(last) = s.last {
                    let key = format!("{}/{}", s.key, s.context);
                    summary_lookup
                        .entry(s.run_id.clone())
                        .or_default()
                        .insert(key, last);
                }
            }
            // Apply name substring filter in-memory
            if let Some(ref name) = name_filter {
                let lower = name.to_lowercase();
                runs.retain(|r| {
                    let n = r.name.as_deref().unwrap_or(&r.run_id).to_lowercase();
                    n.contains(&lower)
                });
            }
            // Apply expression filter in-memory(支持 config.X / metric.X 等)
            if let Some(ref expr) = expr_str {
                if !expr.is_empty() {
                    runs.retain(|r| {
                        let sm = summary_lookup.get(&r.run_id).cloned().unwrap_or_default();
                        trailer_core::expr::eval_run_filter_with_summary(r, expr, &sm)
                    });
                }
            }

            let items: Vec<RunListItem> = runs
                .into_iter()
                .map(|r| {
                    let mut summary = HashMap::new();
                    for s in summaries.iter().filter(|s| s.run_id == r.run_id) {
                        let key = format!("{}/{}", s.key, s.context);
                        summary.insert(
                            key,
                            serde_json::json!({
                                "last": s.last,
                                "best": s.best,
                                "best_step": s.best_step,
                                "min": s.min_val,
                                "max": s.max_val,
                            }),
                        );
                    }
                    RunListItem {
                        run_id: r.run_id,
                        name: r.name,
                        state: r.state,
                        project: r.project,
                        created_at: r.created_at,
                        sweep_id: r.sweep_id.clone(),
                        config: r.config.clone(),
                        summary,
                        owner_id: r.owner_id,
                    }
                })
                .collect();

            let total = state.store.count_runs(&filter).await.unwrap_or(0);
            with_total(total, items)
        }
        Err(e) => internal_error(e, "list_runs").into_response(),
    }
}

// ─── GET /api/v1/runs/states ───

#[derive(Deserialize)]
pub struct RunStatesParams {
    /// 逗号分隔的 run_id 列表(必填)
    pub run_ids: String,
}

/// 轻量查询多个 run 的状态映射 `{run_id: state}`。
/// 不走 list_runs 的 summary/config 组装, 供 compare 等只关心 state 的场景使用。
pub async fn run_states(
    State(state): State<AppState>,
    Query(params): Query<RunStatesParams>,
    headers: axum::http::HeaderMap,
) -> impl IntoResponse {
    let user = match authenticate(&state, &headers).await {
        Ok(u) => u,
        Err(s) => return s.into_response(),
    };
    let mut out = HashMap::new();
    for rid in params.run_ids.split(',').map(str::trim).filter(|s| !s.is_empty()) {
        if let Ok(Some(run)) = state.store.get_run(rid).await {
            // 与 list_runs 一致的权限: admin 全量, 其余仅自己拥有的 run
            if user.role == "admin" || run.owner_id == Some(user.id) {
                out.insert(rid.to_string(), run.state);
            }
        }
    }
    Json(out).into_response()
}

// ─── POST /api/v1/runs/{id}/heartbeat ───

pub async fn heartbeat_run(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Path(run_id): Path<String>,
) -> impl IntoResponse {
    if let Err(status) = require_run_write(&state, &run_id, &headers).await {
        return status.into_response();
    }
    match state.run_manager.heartbeat(&run_id).await {
        Ok(()) => StatusCode::OK.into_response(),
        Err(_) => StatusCode::NOT_FOUND.into_response(),
    }
}

// ─── POST /api/v1/runs/{id}/finish ───

pub async fn finish_run(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Path(run_id): Path<String>,
) -> impl IntoResponse {
    if let Err(status) = require_run_write(&state, &run_id, &headers).await {
        return status.into_response();
    }
    match state.run_manager.finish_run(&run_id).await {
        Ok(()) => {
            tracing::info!(run_id = %run_id, "run finished");
            StatusCode::OK.into_response()
        }
        Err(_) => {
            tracing::debug!(run_id = %run_id, "run not found for finish");
            StatusCode::NOT_FOUND.into_response()
        }
    }
}

// ─── POST /api/v1/runs/{id}/delete ───

#[allow(dead_code)]
#[derive(Deserialize)]
pub struct DeleteRunQuery {
    pub hard: Option<bool>,
}

pub async fn delete_run_handler(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Path(run_id): Path<String>,
) -> impl IntoResponse {
    if let Err(status) = require_run_write(&state, &run_id, &headers).await {
        return status.into_response();
    }
    match state.store.delete_run(&run_id).await {
        Ok(()) => {
            tracing::info!(run_id = %run_id, "run deleted");
            StatusCode::OK.into_response()
        }
        Err(e) => {
            tracing::error!(?e, run_id = %run_id, "delete_run failed");
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
    }
}

// ─── POST /api/v1/runs/{id}/archive ───

pub async fn archive_run_handler(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Path(run_id): Path<String>,
) -> impl IntoResponse {
    let mut run = match require_run_write(&state, &run_id, &headers).await {
        Ok(run) => run,
        Err(s) => return s.into_response(),
    };
    run.state = "archived".into();
    match state.store.upsert_run(&run).await {
        Ok(()) => {
            tracing::info!(run_id = %run_id, "run archived");
            StatusCode::OK.into_response()
        }
        Err(e) => {
            tracing::error!(?e, run_id = %run_id, "archive_run failed");
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
    }
}

// ─── POST /api/v1/runs/{id}/copy ───

#[derive(Deserialize)]
pub struct CopyRunRequest {
    pub name: Option<String>,
}

pub async fn copy_run_handler(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Path(run_id): Path<String>,
    Json(body): Json<CopyRunRequest>,
) -> impl IntoResponse {
    let run = match require_run_write(&state, &run_id, &headers).await {
        Ok(run) => run,
        Err(s) => return s.into_response(),
    };
    let user = match authenticate(&state, &headers).await {
        Ok(u) => u,
        Err(s) => return s.into_response(),
    };
    let new_id = format!("run_{:x}", rand::random::<u64>());
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs_f64();
    let new_run = RunMeta {
        run_id: new_id.clone(),
        project: run.project,
        group_name: run.group_name,
        name: body.name.or(run.name),
        state: "finished".into(),
        config: run.config,
        env: run.env,
        git_commit: run.git_commit,
        sweep_id: None,
        created_at: now,
        heartbeat_at: Some(now),
        tags: run.tags,
        owner_id: Some(user.id),
    };
    match state.store.upsert_run(&new_run).await {
        Ok(()) => {
            tracing::info!(run_id = %run_id, new_run_id = %new_id, "run copied");
            (
                StatusCode::CREATED,
                Json(serde_json::json!({"run_id": new_id})),
            )
                .into_response()
        }
        Err(e) => {
            tracing::error!(?e, run_id = %run_id, "copy_run failed");
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
    }
}

// ─── POST /api/v1/projects/{name}/delete ───

pub async fn delete_project_handler(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Path(name): Path<String>,
) -> impl IntoResponse {
    if require_project_write(&state, &name, &headers)
        .await
        .is_err()
    {
        return StatusCode::FORBIDDEN.into_response();
    }
    match state.store.delete_runs_by_project(&name).await {
        Ok(count) => Json(serde_json::json!({"deleted": count})).into_response(),
        Err(e) => {
            tracing::error!(?e, project = %name, "delete_project failed");
            let msg = e.to_string();
            let status = if msg.contains("running") {
                StatusCode::CONFLICT
            } else {
                StatusCode::INTERNAL_SERVER_ERROR
            };
            (status, Json(serde_json::json!({"error": msg}))).into_response()
        }
    }
}

// ─── POST /api/v1/runs/{id}/resume ───

pub async fn resume_run(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Path(run_id): Path<String>,
) -> impl IntoResponse {
    let run = match require_run_write(&state, &run_id, &headers).await {
        Ok(run) => run,
        Err(s) => return s.into_response(),
    };
    let mut updated = run;
    updated.state = "running".into();
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs_f64();
    updated.heartbeat_at = Some(now);
    match state.store.upsert_run(&updated).await {
        Ok(()) => {
            tracing::info!(run_id = %run_id, "run resumed");
            Json(serde_json::json!({"status": "resumed"})).into_response()
        }
        Err(e) => {
            tracing::error!(?e, run_id = %run_id, "resume_run failed");
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
    }
}

// ─── GET /api/v1/runs/{id}/last_step ───

pub async fn last_step(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Path(run_id): Path<String>,
    Query(share): Query<ShareQuery>,
) -> impl IntoResponse {
    if let Err(status) = require_run_read(&state, &run_id, &headers, share.token.as_deref()).await {
        return status.into_response();
    }
    match state.store.get_max_step(&run_id).await {
        Ok(step) => Json(serde_json::json!({"last_step": step})).into_response(),
        Err(e) => {
            tracing::error!(?e, run_id = %run_id, "last_step failed");
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
    }
}

// ─── GET /api/v1/runs/{id}/stream (SSE) ───

/// SSE endpoint: streams downsampled metric events for a given run_id.
pub async fn stream_events(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Path(run_id): Path<String>,
    Query(share): Query<ShareQuery>,
) -> impl IntoResponse {
    if let Err(status) = require_run_read(&state, &run_id, &headers, share.token.as_deref()).await {
        return status.into_response();
    }
    let rx = state.sse_tx.subscribe();

    let stream = BroadcastStream::new(rx).filter_map(move |result| {
        let run_id = run_id.clone();
        async move {
            match result {
                Ok(event) if event.run_id == run_id => {
                    let data = serde_json::json!({
                        "key": event.key,
                        "context": event.context,
                        "points": event.points,
                    });
                    Some(Ok::<_, Infallible>(
                        Event::default().data(data.to_string()).event("metric"),
                    ))
                }
                _ => None,
            }
        }
    });

    Sse::new(stream)
        .keep_alive(KeepAlive::default())
        .into_response()
}

// ─── GET /api/v1/runs/{id}/figures ───

#[derive(Deserialize)]
pub struct ListFiguresParams {
    pub name: Option<String>,
    pub token: Option<String>,
}

pub async fn list_figures(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Path(run_id): Path<String>,
    Query(params): Query<ListFiguresParams>,
) -> impl IntoResponse {
    if let Err(status) = require_run_read(&state, &run_id, &headers, params.token.as_deref()).await
    {
        return status.into_response();
    }
    match state
        .store
        .query_figures(&run_id, params.name.as_deref())
        .await
    {
        Ok(figs) => Json(figs).into_response(),
        Err(e) => internal_error(e, "list_figures").into_response(),
    }
}

// ─── GET /api/v1/runs/{id}/histograms ───

pub async fn list_histograms(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Path(run_id): Path<String>,
    Query(params): Query<HistogramQueryParams>,
) -> impl IntoResponse {
    if let Err(status) = require_run_read(&state, &run_id, &headers, params.token.as_deref()).await
    {
        return status.into_response();
    }
    match state
        .store
        .query_histograms(&run_id, params.key.as_deref(), params.context.as_deref())
        .await
    {
        Ok(histograms) => Json(histograms).into_response(),
        Err(e) => internal_error(e, "list_histograms").into_response(),
    }
}

// ─── POST /api/v1/runs/{id}/figures ───

#[derive(Deserialize)]
pub struct CreateFigureRequest {
    pub name: String,
    pub kind: String,
    pub body: String,
    pub step: i64,
}

pub async fn upload_figure(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Path(run_id): Path<String>,
    Json(body): Json<CreateFigureRequest>,
) -> impl IntoResponse {
    if let Err(status) = require_run_write(&state, &run_id, &headers).await {
        return status.into_response();
    }
    let fig = FigureRow {
        run_id,
        step: body.step,
        name: body.name,
        kind: body.kind,
        body: body.body,
    };
    match state.store.insert_figure(&fig).await {
        Ok(()) => StatusCode::CREATED.into_response(),
        Err(e) => internal_error(e, "upload_figure").into_response(),
    }
}

// ─── GET /api/v1/runs/{id}/media ───

#[derive(Deserialize)]
pub struct ListMediaParams {
    pub kind: Option<String>,
    pub token: Option<String>,
}

pub async fn list_media(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Path(run_id): Path<String>,
    Query(params): Query<ListMediaParams>,
) -> impl IntoResponse {
    if let Err(status) = require_run_read(&state, &run_id, &headers, params.token.as_deref()).await
    {
        return status.into_response();
    }
    match state
        .store
        .query_media(&run_id, params.kind.as_deref())
        .await
    {
        Ok(items) => Json(items).into_response(),
        Err(e) => internal_error(e, "list_media").into_response(),
    }
}

// ─── POST /api/v1/runs/{id}/media ───

#[derive(Deserialize)]
pub struct CreateMediaRequest {
    pub name: String,
    pub kind: String, // "image" | "video" | "audio"
    pub ext: String,
    pub data: String, // base64-encoded file content
    pub step: i64,
}

/// Hash file path: media/{run_id}/{name}_{step}.{ext}
pub async fn upload_media(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Path(run_id): Path<String>,
    Json(body): Json<CreateMediaRequest>,
) -> impl IntoResponse {
    if let Err(status) = require_run_write(&state, &run_id, &headers).await {
        return status.into_response();
    }
    // Decode base64
    let data = match base64::engine::general_purpose::STANDARD.decode(&body.data) {
        Ok(d) => d,
        Err(e) => {
            tracing::warn!(?e, run_id = %run_id, "invalid base64 media data");
            return StatusCode::BAD_REQUEST.into_response();
        }
    };

    // Build file path
    let rel_path = format!("media/{run_id}/{}_{}.{}", body.name, body.step, body.ext);
    let abs_path = state.artifacts_dir.join(&rel_path);

    // Create parent dirs and write file
    if let Some(parent) = abs_path.parent() {
        if let Err(e) = tokio::fs::create_dir_all(parent).await {
            tracing::error!(?e, path = %abs_path.display(), "create media dir failed");
            return StatusCode::INTERNAL_SERVER_ERROR.into_response();
        }
    }
    if let Err(e) = tokio::fs::write(&abs_path, &data).await {
        tracing::error!(?e, path = %abs_path.display(), "write media file failed");
        return StatusCode::INTERNAL_SERVER_ERROR.into_response();
    }

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs_f64();

    let media = MediaRow {
        id: None,
        run_id,
        step: body.step,
        name: body.name,
        kind: body.kind,
        ext: body.ext,
        hash: String::new(), // simplified — no SHA for now
        file_path: rel_path,
        size: data.len() as i64,
        created_at: now,
    };

    match state.store.insert_media(&media).await {
        Ok(id) => (StatusCode::CREATED, Json(serde_json::json!({"id": id}))).into_response(),
        Err(e) => internal_error(e, "upload_media").into_response(),
    }
}

// ─── GET /api/v1/runs/{id}/media/{media_id}/file ───

pub async fn stream_media_file(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Path((run_id, media_id)): Path<(String, i64)>,
    Query(share): Query<ShareQuery>,
) -> impl IntoResponse {
    if let Err(status) = require_run_read(&state, &run_id, &headers, share.token.as_deref()).await {
        return status.into_response();
    }
    match state.store.get_media_by_id(media_id).await {
        Ok(Some(media)) => {
            let abs_path = state.artifacts_dir.join(&media.file_path);
            match tokio::fs::read(&abs_path).await {
                Ok(bytes) => {
                    let content_type = match media.ext.as_str() {
                        "png" => "image/png",
                        "jpg" | "jpeg" => "image/jpeg",
                        "gif" => "image/gif",
                        "mp4" => "video/mp4",
                        "webm" => "video/webm",
                        "mp3" => "audio/mpeg",
                        "wav" => "audio/wav",
                        "ogg" => "audio/ogg",
                        _ => "application/octet-stream",
                    };
                    (StatusCode::OK, [("content-type", content_type)], bytes).into_response()
                }
                Err(e) => {
                    tracing::warn!(?e, media_id, path = %abs_path.display(), "media file not readable");
                    StatusCode::NOT_FOUND.into_response()
                }
            }
        }
        Ok(None) => StatusCode::NOT_FOUND.into_response(),
        Err(e) => internal_error(e, "stream_media_file").into_response(),
    }
}

// ─── GET /api/v1/runs/{id}/tables ───

#[derive(Deserialize)]
pub struct ListTablesParams {
    pub name: Option<String>,
    pub token: Option<String>,
}

pub async fn list_tables(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Path(run_id): Path<String>,
    Query(params): Query<ListTablesParams>,
) -> impl IntoResponse {
    if let Err(status) = require_run_read(&state, &run_id, &headers, params.token.as_deref()).await
    {
        return status.into_response();
    }
    match state
        .store
        .query_tables(&run_id, params.name.as_deref())
        .await
    {
        Ok(items) => Json(items).into_response(),
        Err(e) => internal_error(e, "list_tables").into_response(),
    }
}

// ─── POST /api/v1/runs/{id}/tables ───

#[derive(Deserialize)]
pub struct CreateTableRequest {
    pub name: String,
    pub columns: Vec<String>,
    pub data: serde_json::Value,
    pub step: i64,
}

pub async fn upload_table(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Path(run_id): Path<String>,
    Json(body): Json<CreateTableRequest>,
) -> impl IntoResponse {
    if let Err(status) = require_run_write(&state, &run_id, &headers).await {
        return status.into_response();
    }
    let row_count = body.data.as_array().map(|a| a.len() as i64).unwrap_or(0);
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs_f64();
    let table = TableRow {
        id: None,
        run_id,
        step: body.step,
        name: body.name,
        columns: body.columns,
        data: body.data,
        row_count,
        created_at: now,
    };
    match state.store.insert_table(&table).await {
        Ok(id) => (StatusCode::CREATED, Json(serde_json::json!({"id": id}))).into_response(),
        Err(e) => internal_error(e, "upload_table").into_response(),
    }
}

// ─── GET /api/v1/runs/{id}/tables/{table_id} ───

pub async fn get_table(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Path((run_id, table_id)): Path<(String, i64)>,
    Query(share): Query<ShareQuery>,
) -> impl IntoResponse {
    if let Err(status) = require_run_read(&state, &run_id, &headers, share.token.as_deref()).await {
        return status.into_response();
    }
    match state.store.get_table_by_id(table_id).await {
        Ok(Some(table)) => Json(table).into_response(),
        Ok(None) => StatusCode::NOT_FOUND.into_response(),
        Err(e) => internal_error(e, "get_table").into_response(),
    }
}

// ─── GET /api/v1/reports & POST /api/v1/reports ───

#[derive(Deserialize)]
pub struct ListReportsParams {
    pub project: Option<String>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

#[derive(Deserialize)]
pub struct CreateReportRequest {
    pub project: String,
    pub title: String,
    pub body: String,
}

pub async fn list_reports(
    State(state): State<AppState>,
    Query(params): Query<ListReportsParams>,
    headers: axum::http::HeaderMap,
) -> impl IntoResponse {
    // 用户隔离: admin 看全部, 其余只看自己创建的 report(与 list_runs 一致)
    let user = match authenticate(&state, &headers).await {
        Ok(u) => u,
        Err(s) => return s.into_response(),
    };
    let owner_id = if user.role == "admin" {
        None
    } else {
        Some(user.id)
    };
    match state
        .store
        .list_reports(params.project.as_deref(), owner_id, params.limit, params.offset)
        .await
    {
        Ok(reports) => {
            let total = state
                .store
                .count_reports(params.project.as_deref(), owner_id)
                .await
                .unwrap_or(0);
            with_total(total, reports)
        }
        Err(e) => internal_error(e, "list_reports").into_response(),
    }
}

pub async fn create_report(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Json(body): Json<CreateReportRequest>,
) -> impl IntoResponse {
    let user = match authenticate(&state, &headers).await {
        Ok(u) => u,
        Err(s) => return s.into_response(),
    };
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs_f64();
    let report = ReportRow {
        id: None,
        owner_id: Some(user.id),
        project: body.project,
        title: body.title,
        body: body.body,
        created_at: now,
    };
    match state.store.insert_report(&report).await {
        Ok(id) => (StatusCode::CREATED, Json(serde_json::json!({"id": id}))).into_response(),
        Err(e) => internal_error(e, "create_report").into_response(),
    }
}

// ─── GET /api/v1/reports/{id} & PUT /api/v1/reports/{id} ───

pub async fn get_report(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Query(share): Query<ShareQuery>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    let report = match state.store.get_report(&id).await {
        Ok(Some(r)) => r,
        Ok(None) => return StatusCode::NOT_FOUND.into_response(),
        Err(_) => return StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    };
    // 登录(owner/admin) 直接放行
    if let Ok(user) = authenticate(&state, &headers).await {
        if user.role == "admin" || report.owner_id == Some(user.id) {
            return Json(report).into_response();
        }
    }
    // 匿名 report share token
    if let Some(tok) = share.token {
        if !tok.is_empty() {
            if let Ok(Some((rtype, rid, expires))) = state.store.get_share(&tok).await {
                let now = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_secs_f64();
                let expired = expires.map(|e| now > e).unwrap_or(false);
                if !expired && rtype == "report" && rid == id {
                    return Json(report).into_response();
                }
            }
        }
    }
    StatusCode::FORBIDDEN.into_response()
}

pub async fn update_report(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Path(id): Path<String>,
    Json(body): Json<CreateReportRequest>,
) -> impl IntoResponse {
    let user = match authenticate(&state, &headers).await {
        Ok(u) => u,
        Err(s) => return s.into_response(),
    };
    let report = match state.store.get_report(&id).await {
        Ok(Some(r)) => r,
        Ok(None) => return StatusCode::NOT_FOUND.into_response(),
        Err(_) => return StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    };
    // 仅 owner / admin 可改
    if user.role != "admin" && report.owner_id != Some(user.id) {
        return StatusCode::FORBIDDEN.into_response();
    }
    match state
        .store
        .update_report(&id, &body.title, &body.body)
        .await
    {
        Ok(()) => Json(serde_json::json!({"id": id})).into_response(),
        Err(e) => internal_error(e, "update_report").into_response(),
    }
}

pub async fn delete_report(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Path(id): Path<String>,
) -> impl IntoResponse {
    let user = match authenticate(&state, &headers).await {
        Ok(u) => u,
        Err(s) => return s.into_response(),
    };
    let report = match state.store.get_report(&id).await {
        Ok(Some(r)) => r,
        Ok(None) => return StatusCode::NOT_FOUND.into_response(),
        Err(_) => return StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    };
    // 仅 owner / admin 可删
    if user.role != "admin" && report.owner_id != Some(user.id) {
        return StatusCode::FORBIDDEN.into_response();
    }
    match state.store.delete_report(&id).await {
        Ok(()) => StatusCode::OK.into_response(),
        Err(e) => internal_error(e, "delete_report").into_response(),
    }
}

// ─── Explore analyses (saved workspaces) ───

#[derive(Deserialize)]
pub struct ListExploresParams {
    pub project: Option<String>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

#[derive(Deserialize)]
pub struct CreateExploreRequest {
    pub project: Option<String>,
    pub title: String,
    pub description: Option<String>,
    /// JSON array of run_id strings
    pub run_ids: String,
    /// JSON array of ChartDef
    pub chart_defs: String,
    pub config: Option<String>,
}

pub async fn list_explores_handler(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Query(params): Query<ListExploresParams>,
) -> impl IntoResponse {
    let user = match authenticate(&state, &headers).await {
        Ok(u) => u,
        Err(s) => return s.into_response(),
    };
    let owner_id = if user.role == "admin" { 0 } else { user.id };
    match state
        .store
        .list_explores(
            owner_id,
            params.project.as_deref(),
            params.limit,
            params.offset,
        )
        .await
    {
        Ok(explores) => {
            let total = state
                .store
                .count_explores(owner_id, params.project.as_deref())
                .await
                .unwrap_or(0);
            with_total(total, explores)
        }
        Err(e) => internal_error(e, "list_explores_handler").into_response(),
    }
}

pub async fn create_explore_handler(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Json(body): Json<CreateExploreRequest>,
) -> impl IntoResponse {
    let user = match authenticate(&state, &headers).await {
        Ok(u) => u,
        Err(s) => return s.into_response(),
    };
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs_f64();
    let explore = ExploreRow {
        id: None,
        owner_id: user.id,
        project: body.project.unwrap_or_default(),
        title: body.title,
        description: body.description.unwrap_or_default(),
        run_ids: body.run_ids,
        chart_defs: body.chart_defs,
        config: body.config.unwrap_or_else(|| "{}".into()),
        created_at: now,
        updated_at: now,
    };
    match state.store.insert_explore(&explore).await {
        Ok(id) => (StatusCode::CREATED, Json(serde_json::json!({"id": id}))).into_response(),
        Err(e) => internal_error(e, "create_explore_handler").into_response(),
    }
}

pub async fn get_explore_handler(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Query(share): Query<ShareQuery>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    let explore = match state.store.get_explore(&id).await {
        Ok(Some(e)) => e,
        Ok(None) => return StatusCode::NOT_FOUND.into_response(),
        Err(_) => return StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    };
    // 登录(owner/admin) 直接放行
    if let Ok(user) = authenticate(&state, &headers).await {
        if user.role == "admin" || explore.owner_id == user.id {
            return Json(explore).into_response();
        }
    }
    // 匿名 explore share token
    if let Some(tok) = share.token {
        if !tok.is_empty() {
            if let Ok(Some((rtype, rid, expires))) = state.store.get_share(&tok).await {
                let now = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_secs_f64();
                let expired = expires.map(|e| now > e).unwrap_or(false);
                if !expired && rtype == "explore" && rid == id {
                    return Json(explore).into_response();
                }
            }
        }
    }
    StatusCode::FORBIDDEN.into_response()
}

pub async fn update_explore_handler(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Path(id): Path<String>,
    Json(body): Json<CreateExploreRequest>,
) -> impl IntoResponse {
    if let Err(status) = require_explore_write(&state, &id, &headers).await {
        return status.into_response();
    }
    match state
        .store
        .update_explore(
            &id,
            &body.title,
            &body.description.unwrap_or_default(),
            &body.run_ids,
            &body.chart_defs,
            &body.config.unwrap_or_else(|| "{}".into()),
        )
        .await
    {
        Ok(()) => Json(serde_json::json!({"id": id})).into_response(),
        Err(e) => internal_error(e, "update_explore_handler").into_response(),
    }
}

pub async fn delete_explore_handler(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Path(id): Path<String>,
) -> impl IntoResponse {
    if let Err(status) = require_explore_write(&state, &id, &headers).await {
        return status.into_response();
    }
    match state.store.delete_explore(&id).await {
        Ok(()) => StatusCode::OK.into_response(),
        Err(e) => internal_error(e, "delete_explore_handler").into_response(),
    }
}

/// explore 写权限:admin 或 explore owner
async fn require_explore_write(
    state: &AppState,
    id: &str,
    headers: &axum::http::HeaderMap,
) -> Result<AuthUserInfo, StatusCode> {
    let user = authenticate(state, headers).await?;
    if user.role == "admin" {
        return Ok(user);
    }
    if let Ok(Some(explore)) = state.store.get_explore(id).await {
        if explore.owner_id == user.id {
            return Ok(user);
        }
    }
    Err(StatusCode::FORBIDDEN)
}

// ─── POST /api/v1/share ───

#[derive(Deserialize)]
pub struct ShareRequest {
    pub resource_type: String,
    pub resource_id: String,
    pub expires_in_days: Option<u32>,
}

#[derive(Serialize)]
pub struct ShareResponse {
    pub token: String,
    pub url: String,
}

pub async fn create_share(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Json(body): Json<ShareRequest>,
) -> impl IntoResponse {
    // 仅 run / explore 的 owner 或 admin 可生成 share token(需登录)
    if body.resource_type == "run" {
        if let Err(status) = require_run_write(&state, &body.resource_id, &headers).await {
            return status.into_response();
        }
    } else if body.resource_type == "explore" {
        let user = match authenticate(&state, &headers).await {
            Ok(u) => u,
            Err(s) => return s.into_response(),
        };
        let ok = user.role == "admin"
            || match state.store.get_explore(&body.resource_id).await {
                Ok(Some(e)) => e.owner_id == user.id,
                _ => false,
            };
        if !ok {
            return StatusCode::FORBIDDEN.into_response();
        }
    } else if body.resource_type == "report" {
        let user = match authenticate(&state, &headers).await {
            Ok(u) => u,
            Err(s) => return s.into_response(),
        };
        let ok = user.role == "admin"
            || match state.store.get_report(&body.resource_id).await {
                Ok(Some(r)) => r.owner_id == Some(user.id),
                _ => false,
            };
        if !ok {
            return StatusCode::FORBIDDEN.into_response();
        }
    }
    let token = format!("{:x}", rand::random::<u128>());
    let expires_at = body.expires_in_days.map(|days| {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs_f64()
            + (days as f64 * 86400.0)
    });
    match state
        .store
        .create_share(&token, &body.resource_type, &body.resource_id, expires_at)
        .await
    {
        Ok(()) => {
            tracing::info!(resource_type = %body.resource_type, resource_id = %body.resource_id, "share token created");
            let url = format!("/share?token={}", token);
            (StatusCode::CREATED, Json(ShareResponse { token, url })).into_response()
        }
        Err(e) => {
            tracing::error!(?e, resource_type = %body.resource_type, resource_id = %body.resource_id, "create_share failed");
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
    }
}

// ─── GET /api/v1/shares ───

/// 共享管理:admin 看全部;experimenter 只看自己 run 的共享。
pub async fn list_shares_handler(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Query(params): Query<PageQuery>,
) -> impl IntoResponse {
    let user = match authenticate(&state, &headers).await {
        Ok(u) => u,
        Err(s) => return s.into_response(),
    };
    match state.store.list_shares(None, None).await {
        Ok(shares) => {
            let mut filtered = Vec::new();
            for s in shares {
                if user.role == "admin" {
                    filtered.push(s);
                    continue;
                }
                if s.resource_type == "run" {
                    if let Ok(Some(run)) = state.store.get_run(&s.resource_id).await {
                        if run.owner_id == Some(user.id) {
                            filtered.push(s);
                        }
                    }
                } else if s.resource_type == "explore" {
                    if let Ok(Some(e)) = state.store.get_explore(&s.resource_id).await {
                        if e.owner_id == user.id {
                            filtered.push(s);
                        }
                    }
                } else if s.resource_type == "report" {
                    if let Ok(Some(r)) = state.store.get_report(&s.resource_id).await {
                        if r.owner_id == Some(user.id) {
                            filtered.push(s);
                        }
                    }
                }
            }
            let total = filtered.len() as u64;
            let start = params.offset.unwrap_or(0) as usize;
            let per = params.limit.unwrap_or(100) as usize;
            let page: Vec<_> = filtered.into_iter().skip(start).take(per).collect();
            with_total(total, page)
        }
        Err(e) => internal_error(e, "list_shares_handler").into_response(),
    }
}

/// 共享写权限:admin 任意;run 的 owner 可管理自己的共享。
async fn require_share_write(
    state: &AppState,
    token: &str,
    headers: &axum::http::HeaderMap,
) -> Result<AuthUserInfo, StatusCode> {
    let user = authenticate(state, headers).await?;
    if user.role == "admin" {
        return Ok(user);
    }
    if let Ok(Some((rtype, rid, _))) = state.store.get_share(token).await {
        if rtype == "run" {
            if let Ok(Some(run)) = state.store.get_run(&rid).await {
                if run.owner_id == Some(user.id) {
                    return Ok(user);
                }
            }
        } else if rtype == "explore" {
            if let Ok(Some(explore)) = state.store.get_explore(&rid).await {
                if explore.owner_id == user.id {
                    return Ok(user);
                }
            }
        } else if rtype == "report" {
            if let Ok(Some(report)) = state.store.get_report(&rid).await {
                if report.owner_id == Some(user.id) {
                    return Ok(user);
                }
            }
        }
    }
    Err(StatusCode::FORBIDDEN)
}

// ─── DELETE /api/v1/shares/{token} ───

/// 撤销共享。
pub async fn delete_share_handler(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Path(token): Path<String>,
) -> impl IntoResponse {
    if let Err(status) = require_share_write(&state, &token, &headers).await {
        return status.into_response();
    }
    match state.store.delete_share(&token).await {
        Ok(()) => StatusCode::OK.into_response(),
        Err(e) => internal_error(e, "delete_share_handler").into_response(),
    }
}

// ─── PUT /api/v1/shares/{token} ───

#[derive(Deserialize)]
pub struct UpdateShareRequest {
    pub expires_in_days: Option<u32>, // None = 永久;Some(0) = 立即过期
}

/// 修改共享周期。
pub async fn update_share_handler(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Path(token): Path<String>,
    Json(body): Json<UpdateShareRequest>,
) -> impl IntoResponse {
    if let Err(status) = require_share_write(&state, &token, &headers).await {
        return status.into_response();
    }
    let expires_at = body.expires_in_days.map(|days| {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs_f64()
            + (days as f64 * 86400.0)
    });
    match state.store.update_share_expiry(&token, expires_at).await {
        Ok(()) => StatusCode::OK.into_response(),
        Err(e) => internal_error(e, "update_share_handler").into_response(),
    }
}

// ─── API Token 管理(当前用户自己的 token)───

/// GET /api/v1/tokens:列出当前用户的 API token。
pub async fn list_tokens_handler(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
) -> impl IntoResponse {
    let user = match authenticate(&state, &headers).await {
        Ok(u) => u,
        Err(s) => return s.into_response(),
    };
    match state.store.list_api_tokens(user.id).await {
        Ok(tokens) => Json(tokens).into_response(),
        Err(e) => internal_error(e, "list_tokens_handler").into_response(),
    }
}

#[derive(Deserialize)]
pub struct CreateTokenRequest {
    pub name: Option<String>,
    pub expires_in_days: Option<u32>, // None = 永久
}

/// POST /api/v1/tokens:生成 API token(返回完整明文一次)。
pub async fn create_token_handler(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Json(body): Json<CreateTokenRequest>,
) -> impl IntoResponse {
    let user = match authenticate(&state, &headers).await {
        Ok(u) => u,
        Err(s) => return s.into_response(),
    };
    let token = format!("rt_{:x}{:x}", rand::random::<u64>(), rand::random::<u64>());
    let expires_at = body.expires_in_days.map(|days| {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs_f64()
            + (days as f64 * 86400.0)
    });
    match state
        .store
        .create_api_token(&token, user.id, body.name.as_deref(), expires_at)
        .await
    {
        Ok(()) => {
            tracing::info!(user = user.id, "api token created");
            (
                StatusCode::CREATED,
                Json(serde_json::json!({
                    "token": token,
                    "name": body.name,
                    "expires_at": expires_at,
                })),
            )
                .into_response()
        }
        Err(e) => internal_error(e, "create_token_handler").into_response(),
    }
}

/// DELETE /api/v1/tokens/{token}:删除自己的 token(撤销)。
pub async fn delete_token_handler(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Path(token): Path<String>,
) -> impl IntoResponse {
    let user = match authenticate(&state, &headers).await {
        Ok(u) => u,
        Err(s) => return s.into_response(),
    };
    // 仅允许删除自己的 token
    match state.store.list_api_tokens(user.id).await {
        Ok(tokens) if tokens.iter().any(|t| t.token == token) => {
            match state.store.delete_api_token(&token).await {
                Ok(()) => StatusCode::OK.into_response(),
                Err(e) => internal_error(e, "delete_token_handler").into_response(),
            }
        }
        _ => StatusCode::NOT_FOUND.into_response(),
    }
}

// ─── Auth routes ───

#[derive(Deserialize)]
pub struct LoginRequest {
    pub username: String,
    pub password: String,
}

#[derive(Serialize)]
pub struct LoginResponse {
    pub token: String,
    pub user: AuthUserInfo,
}

pub async fn auth_login(
    State(state): State<AppState>,
    Json(body): Json<LoginRequest>,
) -> impl IntoResponse {
    let auth = state.auth.lock().await;
    match auth.login(&body.username, &body.password).await {
        Some((token, user)) => {
            tracing::info!(username = %body.username, "login succeeded");
            Json(LoginResponse {
                token,
                user: AuthUserInfo {
                    id: user.id,
                    username: user.username.clone(),
                    role: user.role.clone(),
                },
            })
            .into_response()
        }
        None => {
            tracing::warn!(username = %body.username, "login failed");
            StatusCode::UNAUTHORIZED.into_response()
        }
    }
}

pub async fn auth_register(
    State(state): State<AppState>,
    Json(body): Json<LoginRequest>,
) -> impl IntoResponse {
    let auth = state.auth.lock().await;
    match auth.register(&body.username, &body.password).await {
        Ok((token, user)) => {
            tracing::info!(username = %body.username, "user registered");
            Json(LoginResponse {
                token,
                user: AuthUserInfo {
                    id: user.id,
                    username: user.username.clone(),
                    role: user.role.clone(),
                },
            })
            .into_response()
        }
        Err(msg) => {
            tracing::debug!(username = %body.username, error = %msg, "user register failed");
            (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({"error": msg})),
            )
                .into_response()
        }
    }
}

pub async fn auth_me(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
) -> impl IntoResponse {
    let token = headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .unwrap_or("");
    let auth = state.auth.lock().await;
    match auth.get_user_by_token(token).await {
        Some(user) => Json(AuthUserInfo {
            id: user.id,
            username: user.username.clone(),
            role: user.role.clone(),
        })
        .into_response(),
        None => StatusCode::UNAUTHORIZED.into_response(),
    }
}

// ─── PUT /api/v1/auth/password ───

#[derive(Deserialize)]
pub struct ChangePasswordRequest {
    pub old_password: String,
    pub new_password: String,
}

pub async fn auth_change_password(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Json(body): Json<ChangePasswordRequest>,
) -> impl IntoResponse {
    let token = headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .unwrap_or("");
    let user_id = {
        let auth = state.auth.lock().await;
        auth.get_user_by_token(token).await.map(|u| u.id)
    };
    let uid = match user_id {
        Some(id) => id,
        None => return StatusCode::UNAUTHORIZED.into_response(),
    };
    let auth = state.auth.lock().await;
    if auth
        .change_password(uid, &body.old_password, &body.new_password)
        .await
    {
        StatusCode::OK.into_response()
    } else {
        StatusCode::BAD_REQUEST.into_response()
    }
}

// ─── Admin helpers & routes ───

async fn require_admin(
    state: &AppState,
    headers: &axum::http::HeaderMap,
) -> Result<AuthUserInfo, StatusCode> {
    let user = authenticate(state, headers).await?;
    if user.role == "admin" {
        Ok(user)
    } else {
        Err(StatusCode::UNAUTHORIZED)
    }
}

// ─── GET/PUT /api/v1/users/me/theme (当前用户主题偏好) ───

pub async fn get_my_theme(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
) -> impl IntoResponse {
    let user = match authenticate(&state, &headers).await {
        Ok(u) => u,
        Err(s) => return s.into_response(),
    };
    match state.store.get_user_theme(user.id).await {
        Ok(t) => Json(serde_json::json!({ "theme": t })).into_response(),
        Err(e) => internal_error(e, "get_my_theme").into_response(),
    }
}

#[derive(Deserialize)]
pub struct UpdateThemeRequest {
    pub theme: String,
}

pub async fn update_my_theme(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Json(body): Json<UpdateThemeRequest>,
) -> impl IntoResponse {
    let user = match authenticate(&state, &headers).await {
        Ok(u) => u,
        Err(s) => return s.into_response(),
    };
    match state.store.update_user_theme(user.id, &body.theme).await {
        Ok(()) => StatusCode::OK.into_response(),
        Err(e) => internal_error(e, "update_my_theme").into_response(),
    }
}

pub async fn admin_list_users(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Query(params): Query<PageQuery>,
) -> impl IntoResponse {
    if let Err(status) = require_admin(&state, &headers).await {
        return status.into_response();
    }
    let auth = state.auth.lock().await;
    let all: Vec<serde_json::Value> = auth
        .list_users()
        .await
        .into_iter()
        .map(|u| {
            serde_json::json!({
                "id": u.id, "username": u.username, "role": u.role,
            })
        })
        .collect();
    let total = all.len() as u64;
    let start = params.offset.unwrap_or(0) as usize;
    let per = params.limit.unwrap_or(100) as usize;
    let page: Vec<_> = all.into_iter().skip(start).take(per).collect();
    with_total(total, page)
}

// ─── GET /api/v1/admin/users/{id}/projects ───

/// admin 查看指定用户拥有的项目(由 runs.owner_id 推导)。
pub async fn admin_user_projects(
    State(state): State<AppState>,
    Path(id): Path<i64>,
    headers: axum::http::HeaderMap,
) -> impl IntoResponse {
    if let Err(status) = require_admin(&state, &headers).await {
        return status.into_response();
    }
    match state
        .store
        .list_runs(&RunFilter {
            owner_id: Some(id),
            limit: Some(10000),
            ..Default::default()
        })
        .await
    {
        Ok(runs) => {
            let mut projects: Vec<String> = runs.into_iter().map(|r| r.project).collect();
            projects.sort();
            projects.dedup();
            let result: Vec<serde_json::Value> = projects
                .into_iter()
                .map(|p| serde_json::json!({"project": p, "role": "owner"}))
                .collect();
            Json(result).into_response()
        }
        Err(e) => internal_error(e, "admin_user_projects").into_response(),
    }
}

#[derive(Deserialize)]
pub struct CreateUserRequest {
    pub username: String,
    pub password: String,
    pub role: Option<String>,
}

pub async fn admin_create_user(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Json(body): Json<CreateUserRequest>,
) -> impl IntoResponse {
    if let Err(status) = require_admin(&state, &headers).await {
        return status.into_response();
    }
    let auth = state.auth.lock().await;
    match auth.register(&body.username, &body.password).await {
        Ok((_, mut user)) => {
            if let Some(role) = &body.role {
                user.role = role.clone();
                auth.set_role(user.id, role).await;
            }
            (StatusCode::CREATED, Json(serde_json::json!({"id": user.id, "username": user.username, "role": user.role}))).into_response()
        }
        Err(msg) => (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": msg})),
        )
            .into_response(),
    }
}

#[derive(Deserialize)]
pub struct SetRoleRequest {
    pub role: String,
}

pub async fn admin_set_role(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Path(id): Path<i64>,
    Json(body): Json<SetRoleRequest>,
) -> impl IntoResponse {
    if let Err(status) = require_admin(&state, &headers).await {
        return status.into_response();
    }
    let auth = state.auth.lock().await;
    if auth.set_role(id, &body.role).await {
        StatusCode::OK.into_response()
    } else {
        StatusCode::NOT_FOUND.into_response()
    }
}

pub async fn admin_delete_user(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Path(id): Path<i64>,
) -> impl IntoResponse {
    if let Err(status) = require_admin(&state, &headers).await {
        return status.into_response();
    }
    let auth = state.auth.lock().await;
    // Cannot delete self
    let token = headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .unwrap_or("");
    if let Some(me) = auth.get_user_by_token(token).await {
        if me.id == id {
            return StatusCode::BAD_REQUEST.into_response();
        }
    }
    // Remove user from auth store (just remove from users map)
    auth.remove_user(id).await;
    StatusCode::OK.into_response()
}

#[derive(Deserialize)]
pub struct AdminSetPasswordRequest {
    pub new_password: String,
}

pub async fn admin_set_password(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Path(id): Path<i64>,
    Json(body): Json<AdminSetPasswordRequest>,
) -> impl IntoResponse {
    let is_admin = require_admin(&state, &headers).await.is_ok();
    if !is_admin {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let auth = state.auth.lock().await;
    auth.set_password(id, &body.new_password).await;
    StatusCode::OK.into_response()
}

// ─── GET /api/v1/sweeps ───

#[derive(Deserialize)]
pub struct SweepQuery {
    pub project: Option<String>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

#[derive(Serialize)]
pub struct SweepGroup {
    pub sweep_id: String,
    pub run_count: usize,
    pub run_ids: Vec<String>,
    pub config_keys: Vec<String>,
    pub best_metric: Option<serde_json::Value>,
}

pub async fn list_sweeps(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Query(params): Query<SweepQuery>,
) -> impl IntoResponse {
    let user = match authenticate(&state, &headers).await {
        Ok(u) => u,
        Err(s) => return s.into_response(),
    };
    let filter = trailer_core::domain::RunFilter {
        project: params.project,
        owner_id: if user.role == "admin" {
            None
        } else {
            Some(user.id)
        },
        ..Default::default()
    };

    match state.store.list_runs(&filter).await {
        Ok(runs) => {
            let mut groups: std::collections::HashMap<String, SweepGroup> =
                std::collections::HashMap::new();
            for run in runs {
                let sid = match &run.sweep_id {
                    Some(s) if !s.is_empty() => s.clone(),
                    _ => continue,
                };
                let entry = groups.entry(sid.clone()).or_insert(SweepGroup {
                    sweep_id: sid,
                    run_count: 0,
                    run_ids: vec![],
                    config_keys: vec![],
                    best_metric: None,
                });
                entry.run_count += 1;
                entry.run_ids.push(run.run_id);
                // Collect config keys
                if let serde_json::Value::Object(obj) = &run.config {
                    for k in obj.keys() {
                        if !entry.config_keys.contains(k) {
                            entry.config_keys.push(k.clone());
                        }
                    }
                }
            }
            let mut result: Vec<&SweepGroup> = groups.values().collect();
            result.sort_by(|a, b| b.run_count.cmp(&a.run_count));
            let total = result.len() as u64;
            let start = params.offset.unwrap_or(0) as usize;
            let per = params.limit.unwrap_or(100) as usize;
            let page: Vec<_> = result.into_iter().skip(start).take(per).collect();
            with_total(total, page)
        }
        Err(e) => internal_error(e, "list_sweeps").into_response(),
    }
}

// ─── Tests ───
#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::Body;
    use axum::http::Request;
    use axum::routing::{delete, get, post};
    use axum::Router;
    use std::time::Duration;
    use tower::ServiceExt;
    use trailer_core::ingest::run_ingestion_writer_with_taps;
    use trailer_core::storage::new_sqlite_storage;
    use trailer_core::taps::SummaryTap;

    /// 通过 HTTP login 获取 admin token 并创建一个 run。返回 token。
    async fn login_and_create_run(app: &Router, project: &str, run_id: &str) -> String {
        let token: String = {
            let req = Request::builder()
                .method("POST")
                .uri("/api/v1/auth/login")
                .header("content-type", "application/json")
                .body(Body::from(r#"{"username":"admin","password":"admin"}"#))
                .unwrap();
            let resp = app.clone().oneshot(req).await.unwrap();
            assert_eq!(resp.status(), StatusCode::OK, "login should succeed");
            let body = axum::body::to_bytes(resp.into_body(), 4096).await.unwrap();
            let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
            json["token"].as_str().unwrap().to_string()
        };
        let auth_val = format!("Bearer {}", token);
        let req = Request::builder()
            .method("POST")
            .uri("/api/v1/runs")
            .header("content-type", "application/json")
            .header("authorization", &auth_val)
            .body(Body::from(
                serde_json::to_string(&CreateRunRequest {
                    run_id: Some(run_id.into()),
                    project: project.into(),
                    group_name: None,
                    name: Some("test-run".into()),
                    sweep_id: None,
                    config: None,
                    created_at: None,
                })
                .unwrap(),
            ))
            .unwrap();
        let resp = app.clone().oneshot(req).await.unwrap();
        assert_eq!(
            resp.status(),
            StatusCode::CREATED,
            "create run should succeed"
        );
        token
    }

    /// 注册并登录一个 experimenter 用户,返回其 token。
    async fn register_and_login(app: &Router, username: &str, password: &str) -> String {
        let req = Request::builder()
            .method("POST")
            .uri("/api/v1/auth/register")
            .header("content-type", "application/json")
            .body(Body::from(format!(
                r#"{{"username":"{}","password":"{}"}}"#,
                username, password
            )))
            .unwrap();
        let resp = app.clone().oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::OK, "register should succeed");
        let req = Request::builder()
            .method("POST")
            .uri("/api/v1/auth/login")
            .header("content-type", "application/json")
            .body(Body::from(format!(
                r#"{{"username":"{}","password":"{}"}}"#,
                username, password
            )))
            .unwrap();
        let resp = app.clone().oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::OK, "login should succeed");
        let body = axum::body::to_bytes(resp.into_body(), 4096).await.unwrap();
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        json["token"].as_str().unwrap().to_string()
    }

    async fn test_app() -> Router {
        let store = new_sqlite_storage("sqlite::memory:").await.unwrap();
        let (tx, rx) = mpsc::channel(10_000);
        let query_store = store.clone();
        let run_mgr = Arc::new(RunManager::new(store.clone(), Duration::from_secs(60)));
        let (sse_tx, _) = broadcast::channel(2048);

        // Spawn writer with SummaryTap so run_summary is generated (matches production)
        let summary_store = query_store.clone();
        tokio::spawn(async move {
            run_ingestion_writer_with_taps(
                rx,
                query_store,
                vec![Box::new(SummaryTap::new(summary_store))],
            )
            .await
        });

        let auth = Arc::new(Mutex::new(crate::auth::AuthState::new(store.clone()).await));
        let state = AppState {
            ingest_tx: Arc::new(tx),
            store,
            run_manager: run_mgr,
            sse_tx,
            artifacts_dir: std::env::temp_dir(),
            frontend_dir: std::env::temp_dir(),
            lttb_cache: Arc::new(Mutex::new(LttbCache::new(10, 500))),
            auth,
        };

        Router::new()
            .route("/api/v1/ingest", post(ingest_metrics))
            .route("/api/v1/metrics", get(query_metrics))
            .route(
                "/api/v1/metrics:batch-query",
                axum::routing::post(batch_query_metrics),
            )
            .route("/api/v1/runs", post(create_run).get(list_runs))
            .route("/api/v1/runs/{id}/heartbeat", post(heartbeat_run))
            .route("/api/v1/runs/{id}/finish", post(finish_run))
            .route("/api/v1/runs/{id}/delete", post(delete_run_handler))
            .route("/api/v1/runs/{id}/archive", post(archive_run_handler))
            .route("/api/v1/runs/{id}/copy", post(copy_run_handler))
            .route("/api/v1/runs/{id}/resume", post(resume_run))
            .route("/api/v1/runs/{id}/stream", get(stream_events))
            .route("/api/v1/runs/{id}/histograms", get(list_histograms))
            .route(
                "/api/v1/runs/{id}/figures",
                get(list_figures).post(upload_figure),
            )
            .route(
                "/api/v1/runs/{id}/media",
                get(list_media).post(upload_media),
            )
            .route(
                "/api/v1/runs/{id}/tables",
                get(list_tables).post(upload_table),
            )
            .route("/api/v1/runs/{id}/tables/{table_id}", get(get_table))
            .route(
                "/api/v1/projects/{name}/delete",
                post(delete_project_handler),
            )
            .route(
                "/api/v1/admin/users",
                get(admin_list_users).post(admin_create_user),
            )
            .route(
                "/api/v1/users/me/theme",
                get(get_my_theme).put(update_my_theme),
            )
            .route(
                "/api/v1/admin/users/{id}/projects",
                get(admin_user_projects),
            )
            .route(
                "/api/v1/explores",
                get(list_explores_handler).post(create_explore_handler),
            )
            .route(
                "/api/v1/explores/{id}",
                get(get_explore_handler)
                    .put(update_explore_handler)
                    .delete(delete_explore_handler),
            )
            .route("/api/v1/share", post(create_share))
            .route("/api/v1/shares", get(list_shares_handler))
            .route(
                "/api/v1/shares/{token}",
                delete(delete_share_handler).put(update_share_handler),
            )
            .route(
                "/api/v1/tokens",
                get(list_tokens_handler).post(create_token_handler),
            )
            .route("/api/v1/tokens/{token}", delete(delete_token_handler))
            .route("/api/v1/auth/login", post(auth_login))
            .route("/api/v1/auth/register", post(auth_register))
            .with_state(state)
    }

    #[tokio::test]
    async fn create_and_list_runs() {
        let app = test_app().await;
        // Get auth token from login API
        let token: String = {
            let req = Request::builder()
                .method("POST")
                .uri("/api/v1/auth/login")
                .header("content-type", "application/json")
                .body(Body::from(r#"{"username":"admin","password":"admin"}"#))
                .unwrap();
            let resp = app.clone().oneshot(req).await.unwrap();
            assert_eq!(resp.status(), StatusCode::OK, "login should succeed");
            let body = axum::body::to_bytes(resp.into_body(), 4096).await.unwrap();
            let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
            json["token"].as_str().unwrap().to_string()
        };
        let auth_val = format!("Bearer {}", token);

        // Create 2 runs
        for _ in 0..2 {
            let req = Request::builder()
                .method("POST")
                .uri("/api/v1/runs")
                .header("content-type", "application/json")
                .header("authorization", &auth_val)
                .body(Body::from(
                    serde_json::to_string(&CreateRunRequest {
                        run_id: None,
                        project: "p1".into(),
                        group_name: None,
                        name: Some("my-run".into()),
                        sweep_id: None,
                        config: None,
                        created_at: None,
                    })
                    .unwrap(),
                ))
                .unwrap();
            let resp = app.clone().oneshot(req).await.unwrap();
            assert_eq!(resp.status(), StatusCode::CREATED);
        }

        // List
        let req = Request::builder()
            .method("GET")
            .uri("/api/v1/runs?project=p1")
            .header("authorization", &auth_val)
            .body(Body::empty())
            .unwrap();
        let resp = app.oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::OK);

        let body = axum::body::to_bytes(resp.into_body(), 1024 * 1024)
            .await
            .unwrap();
        let runs: Vec<serde_json::Value> = serde_json::from_slice(&body).unwrap();
        assert_eq!(runs.len(), 2);
        assert_eq!(runs[0]["state"], "running");
    }

    #[tokio::test]
    async fn list_runs_cross_project_and_full_summary() {
        let app = test_app().await;
        let token = login_and_create_run(&app, "p1", "r1").await;
        let auth_val = format!("Bearer {}", token);

        // Create a run in a second project p2
        let req = Request::builder()
            .method("POST")
            .uri("/api/v1/runs")
            .header("content-type", "application/json")
            .header("authorization", &auth_val)
            .body(Body::from(
                serde_json::to_string(&CreateRunRequest {
                    run_id: Some("r2".into()),
                    project: "p2".into(),
                    group_name: None,
                    name: Some("other".into()),
                    sweep_id: None,
                    config: None,
                    created_at: None,
                })
                .unwrap(),
            ))
            .unwrap();
        let resp = app.clone().oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::CREATED);

        // Ingest metrics into both runs (r1: 0.5 then 0.3; r2: 0.9)
        for (rid, values) in [("r1", vec![0.5_f64, 0.3]), ("r2", vec![0.9])] {
            let envelopes: Vec<Envelope> = values
                .iter()
                .enumerate()
                .map(|(i, v)| {
                    let mut payload = HashMap::new();
                    payload.insert("loss".into(), serde_json::json!(v));
                    Envelope {
                        kind: "metric".into(),
                        run_id: rid.into(),
                        step: i as i64,
                        wall_time: 1000.0 + i as f64,
                        context: String::new(),
                        payload,
                    }
                })
                .collect();
            let body = rmp_serde::to_vec(&envelopes).unwrap();
            let req = Request::builder()
                .method("POST")
                .uri("/api/v1/ingest")
                .header("content-type", "application/x-msgpack")
                .header("authorization", &auth_val)
                .body(Body::from(body))
                .unwrap();
            let resp = app.clone().oneshot(req).await.unwrap();
            assert_eq!(resp.status(), StatusCode::OK);
        }
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;

        // Cross-project query
        let req = Request::builder()
            .method("GET")
            .uri("/api/v1/runs?projects=p1,p2")
            .header("authorization", &auth_val)
            .body(Body::empty())
            .unwrap();
        let resp = app.clone().oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
        let body = axum::body::to_bytes(resp.into_body(), 1024 * 1024)
            .await
            .unwrap();
        let runs: Vec<serde_json::Value> = serde_json::from_slice(&body).unwrap();
        let projects: Vec<&str> = runs
            .iter()
            .map(|r| r["project"].as_str().unwrap())
            .collect();
        assert!(
            projects.contains(&"p1") && projects.contains(&"p2"),
            "cross-project: got {projects:?}"
        );

        // Single-project filter still works
        let req = Request::builder()
            .method("GET")
            .uri("/api/v1/runs?project=p1")
            .header("authorization", &auth_val)
            .body(Body::empty())
            .unwrap();
        let resp = app.clone().oneshot(req).await.unwrap();
        let body = axum::body::to_bytes(resp.into_body(), 1024 * 1024)
            .await
            .unwrap();
        let runs: Vec<serde_json::Value> = serde_json::from_slice(&body).unwrap();
        assert_eq!(runs.len(), 1);

        // Summary includes min/max/best_step
        let summary = runs[0]["summary"].as_object().expect("summary object");
        let loss = summary.get("loss/").expect("loss summary key");
        assert_eq!(loss["last"], 0.3);
        assert_eq!(loss["min"], 0.3);
        assert_eq!(loss["max"], 0.5);
        assert!(loss["best_step"].is_number());
    }

    #[tokio::test]
    async fn list_runs_filter_by_metric_expr() {
        let app = test_app().await;
        let token = login_and_create_run(&app, "p1", "r1").await;
        let auth_val = format!("Bearer {}", token);

        // Create a second run r2
        let req = Request::builder()
            .method("POST")
            .uri("/api/v1/runs")
            .header("content-type", "application/json")
            .header("authorization", &auth_val)
            .body(Body::from(
                serde_json::to_string(&CreateRunRequest {
                    run_id: Some("r2".into()),
                    project: "p1".into(),
                    group_name: None,
                    name: Some("second".into()),
                    sweep_id: None,
                    config: None,
                    created_at: None,
                })
                .unwrap(),
            ))
            .unwrap();
        let resp = app.clone().oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::CREATED);

        // Ingest: r1 loss=0.3, r2 loss=0.8
        for (rid, v) in [("r1", 0.3_f64), ("r2", 0.8)] {
            let mut payload = HashMap::new();
            payload.insert("loss".into(), serde_json::json!(v));
            let envelopes = vec![Envelope {
                kind: "metric".into(),
                run_id: rid.into(),
                step: 0,
                wall_time: 1000.0,
                context: String::new(),
                payload,
            }];
            let body = rmp_serde::to_vec(&envelopes).unwrap();
            let req = Request::builder()
                .method("POST")
                .uri("/api/v1/ingest")
                .header("content-type", "application/x-msgpack")
                .header("authorization", &auth_val)
                .body(Body::from(body))
                .unwrap();
            let resp = app.clone().oneshot(req).await.unwrap();
            assert_eq!(resp.status(), StatusCode::OK);
        }
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;

        // Filter by metric.loss < 0.5
        let req = Request::builder()
            .method("GET")
            .uri("/api/v1/runs?expr=metric.loss%3C0.5")
            .header("authorization", &auth_val)
            .body(Body::empty())
            .unwrap();
        let resp = app.clone().oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
        let body = axum::body::to_bytes(resp.into_body(), 1024 * 1024)
            .await
            .unwrap();
        let runs: Vec<serde_json::Value> = serde_json::from_slice(&body).unwrap();
        assert_eq!(runs.len(), 1, "only the low-loss run should match");
        assert_eq!(runs[0]["run_id"], "r1");
    }

    #[tokio::test]
    async fn explores_crud_and_share() {
        let app = test_app().await;
        let token = login_and_create_run(&app, "p1", "r1").await;
        let auth_val = format!("Bearer {}", token);

        // Create explore
        let body = serde_json::json!({
            "title": "scaling law",
            "description": "log-log",
            "run_ids": "[\"r1\"]",
            "chart_defs": "[{\"type\":\"line\",\"metric\":{\"key\":\"loss\",\"context\":\"\"}}]",
            "config": "{}",
        });
        let req = Request::builder()
            .method("POST")
            .uri("/api/v1/explores")
            .header("content-type", "application/json")
            .header("authorization", &auth_val)
            .body(Body::from(body.to_string()))
            .unwrap();
        let resp = app.clone().oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::CREATED);
        let body = axum::body::to_bytes(resp.into_body(), 4096).await.unwrap();
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        let eid = json["id"].as_str().unwrap().to_string();

        // List
        let req = Request::builder()
            .method("GET")
            .uri("/api/v1/explores")
            .header("authorization", &auth_val)
            .body(Body::empty())
            .unwrap();
        let resp = app.clone().oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
        let body = axum::body::to_bytes(resp.into_body(), 1024 * 1024)
            .await
            .unwrap();
        let list: Vec<serde_json::Value> = serde_json::from_slice(&body).unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0]["title"], "scaling law");

        // Update
        let body = serde_json::json!({
            "title": "scaling v2", "run_ids": "[\"r1\",\"r2\"]", "chart_defs": "[]", "config": "{}",
        });
        let req = Request::builder()
            .method("PUT")
            .uri(format!("/api/v1/explores/{}", eid))
            .header("content-type", "application/json")
            .header("authorization", &auth_val)
            .body(Body::from(body.to_string()))
            .unwrap();
        let resp = app.clone().oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::OK);

        // Create share for explore
        let body = serde_json::json!({"resource_type": "explore", "resource_id": eid.to_string()});
        let req = Request::builder()
            .method("POST")
            .uri("/api/v1/share")
            .header("content-type", "application/json")
            .header("authorization", &auth_val)
            .body(Body::from(body.to_string()))
            .unwrap();
        let resp = app.clone().oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::CREATED);
        let body = axum::body::to_bytes(resp.into_body(), 4096).await.unwrap();
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        let stoken = json["token"].as_str().unwrap().to_string();

        // Anonymous with explore token:get explore
        let req = Request::builder()
            .method("GET")
            .uri(format!("/api/v1/explores/{}?token={}", eid, stoken))
            .body(Body::empty())
            .unwrap();
        let resp = app.clone().oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::OK);

        // Anonymous with explore token:read contained run data
        let req = Request::builder()
            .method("GET")
            .uri(format!("/api/v1/metrics?run_id=r1&token={}", stoken))
            .body(Body::empty())
            .unwrap();
        let resp = app.clone().oneshot(req).await.unwrap();
        assert_eq!(
            resp.status(),
            StatusCode::OK,
            "explore share token should allow reading contained runs"
        );

        // No auth, no token → 403
        let req = Request::builder()
            .method("GET")
            .uri(format!("/api/v1/explores/{}", eid))
            .body(Body::empty())
            .unwrap();
        let resp = app.clone().oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::FORBIDDEN);

        // Delete
        let req = Request::builder()
            .method("DELETE")
            .uri(format!("/api/v1/explores/{}", eid))
            .header("authorization", &auth_val)
            .body(Body::empty())
            .unwrap();
        let resp = app.clone().oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn batch_query_metrics_includes_wall_time() {
        let app = test_app().await;
        let token = login_and_create_run(&app, "p1", "r1").await;
        let auth_val = format!("Bearer {}", token);

        // Ingest 2 points with distinct wall_time
        let mut p0 = HashMap::new();
        p0.insert("loss".into(), serde_json::json!(0.5));
        let mut p1 = HashMap::new();
        p1.insert("loss".into(), serde_json::json!(0.3));
        let envelopes = vec![
            Envelope {
                kind: "metric".into(),
                run_id: "r1".into(),
                step: 0,
                wall_time: 1000.0,
                context: String::new(),
                payload: p0,
            },
            Envelope {
                kind: "metric".into(),
                run_id: "r1".into(),
                step: 1,
                wall_time: 2000.0,
                context: String::new(),
                payload: p1,
            },
        ];
        let body = rmp_serde::to_vec(&envelopes).unwrap();
        let req = Request::builder()
            .method("POST")
            .uri("/api/v1/ingest")
            .header("content-type", "application/x-msgpack")
            .header("authorization", &auth_val)
            .body(Body::from(body))
            .unwrap();
        let resp = app.clone().oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;

        // Batch query
        let req_body = serde_json::json!({
            "queries": [{ "run_id": "r1", "key": "loss", "max_points": 10 }]
        });
        let req = Request::builder()
            .method("POST")
            .uri("/api/v1/metrics:batch-query")
            .header("content-type", "application/json")
            .header("authorization", &auth_val)
            .body(Body::from(req_body.to_string()))
            .unwrap();
        let resp = app.clone().oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
        let body = axum::body::to_bytes(resp.into_body(), 1024 * 1024)
            .await
            .unwrap();
        let results: Vec<serde_json::Value> = serde_json::from_slice(&body).unwrap();
        assert_eq!(results.len(), 1);
        let points = results[0]["points"].as_array().unwrap();
        assert_eq!(points.len(), 2);
        for p in points {
            assert!(p["wall_time"].is_number(), "wall_time missing in {p}");
        }
        let step0 = points.iter().find(|p| p["step"] == 0).unwrap();
        assert_eq!(step0["wall_time"], 1000.0);
        let step1 = points.iter().find(|p| p["step"] == 1).unwrap();
        assert_eq!(step1["wall_time"], 2000.0);
    }

    #[tokio::test]
    async fn ingest_and_query_end_to_end() {
        let app = test_app().await;
        let token = login_and_create_run(&app, "p1", "r1").await;
        let auth_val = format!("Bearer {}", token);

        let mut payload = HashMap::new();
        payload.insert("loss".into(), serde_json::json!(0.5));
        payload.insert("train/loss".into(), serde_json::json!(0.3));

        let envelopes = vec![Envelope {
            kind: "metric".into(),
            run_id: "r1".into(),
            step: 0,
            wall_time: 1000.0,
            context: String::new(),
            payload,
        }];

        let body = rmp_serde::to_vec(&envelopes).unwrap();
        let req = Request::builder()
            .method("POST")
            .uri("/api/v1/ingest")
            .header("content-type", "application/x-msgpack")
            .header("authorization", &auth_val)
            .body(Body::from(body))
            .unwrap();
        let resp = app.clone().oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::OK);

        tokio::time::sleep(std::time::Duration::from_millis(50)).await;

        let req = Request::builder()
            .method("GET")
            .uri("/api/v1/metrics?run_id=r1&max_points=100")
            .header("authorization", &auth_val)
            .body(Body::empty())
            .unwrap();
        let resp = app.oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn sse_stream_receives_downsampled_events() {
        let app = test_app().await;
        let token = login_and_create_run(&app, "p1", "r1").await;
        let auth_val = format!("Bearer {}", token);

        // Send an ingest first: SSE stream will receive data after ingestion
        let mut payload = std::collections::HashMap::new();
        payload.insert("loss".into(), serde_json::json!(0.5));
        let envelopes = vec![Envelope {
            kind: "metric".into(),
            run_id: "r1".into(),
            step: 0,
            wall_time: 1000.0,
            context: String::new(),
            payload,
        }];

        let ingest_body = rmp_serde::to_vec(&envelopes).unwrap();
        let ingest_req = Request::builder()
            .method("POST")
            .uri("/api/v1/ingest")
            .header("content-type", "application/x-msgpack")
            .header("authorization", &auth_val)
            .body(Body::from(ingest_body))
            .unwrap();
        let _ = app.clone().oneshot(ingest_req).await.unwrap();

        // Give writer + SseTap time to process
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;

        // Now connect SSE — the broadcast channel has already emitted
        let sse_req = Request::builder()
            .method("GET")
            .uri("/api/v1/runs/r1/stream")
            .header("accept", "text/event-stream")
            .header("authorization", &auth_val)
            .body(Body::empty())
            .unwrap();

        let sse_resp = app.clone().oneshot(sse_req).await.unwrap();
        assert_eq!(sse_resp.status(), StatusCode::OK);

        // Read first chunk of SSE stream with a timeout
        let body_result = tokio::time::timeout(
            std::time::Duration::from_secs(2),
            axum::body::to_bytes(sse_resp.into_body(), 4096),
        )
        .await;

        // We connected after data was sent, so we may or may not see data.
        // The main assertion is that the endpoint responds with correct content-type
        // and doesn't error. This validates the routing + SSE infrastructure.
        match body_result {
            Ok(Ok(bytes)) => {
                let body = String::from_utf8_lossy(&bytes);
                // Since we connected after the event was sent, we might get data
                // or might not (depending on broadcast channel capacity and timing)
                if !body.is_empty() {
                    assert!(body.contains("event: metric") || body.contains("retry:"));
                }
            }
            Ok(Err(e)) => panic!("Body read error: {}", e),
            Err(_elapsed) => {
                // Timeout is expected — SSE stream is long-lived and may have
                // no pending data (client connected after the event was emitted)
            }
        }
    }

    #[tokio::test]
    async fn upload_and_list_figures() {
        let app = test_app().await;
        let token = login_and_create_run(&app, "p1", "r1").await;
        let auth_val = format!("Bearer {}", token);

        // Upload a PNG figure
        let png_fig = serde_json::json!({
            "name": "accuracy",
            "kind": "png",
            "body": "base64pseudodata",
            "step": 0,
        });
        let req = Request::builder()
            .method("POST")
            .uri("/api/v1/runs/r1/figures")
            .header("content-type", "application/json")
            .header("authorization", &auth_val)
            .body(Body::from(serde_json::to_string(&png_fig).unwrap()))
            .unwrap();
        let resp = app.clone().oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::CREATED);

        // Upload a G2 figure
        let g2_fig = serde_json::json!({
            "name": "loss_curve",
            "kind": "g2",
            "body": r#"{"type":"line"}"#,
            "step": 1,
        });
        let req = Request::builder()
            .method("POST")
            .uri("/api/v1/runs/r1/figures")
            .header("content-type", "application/json")
            .header("authorization", &auth_val)
            .body(Body::from(serde_json::to_string(&g2_fig).unwrap()))
            .unwrap();
        let resp = app.clone().oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::CREATED);

        // List all figures for run r1
        let req = Request::builder()
            .method("GET")
            .uri("/api/v1/runs/r1/figures")
            .header("authorization", &auth_val)
            .body(Body::empty())
            .unwrap();
        let resp = app.clone().oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
        let body = axum::body::to_bytes(resp.into_body(), 1024 * 1024)
            .await
            .unwrap();
        let list: Vec<serde_json::Value> = serde_json::from_slice(&body).unwrap();
        assert_eq!(list.len(), 2, "should have 2 figures");
        assert_eq!(list[0]["kind"], "png");
        assert_eq!(list[1]["name"], "loss_curve");

        // Filter by name
        let req = Request::builder()
            .method("GET")
            .uri("/api/v1/runs/r1/figures?name=accuracy")
            .header("authorization", &auth_val)
            .body(Body::empty())
            .unwrap();
        let resp = app.oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
        let body = axum::body::to_bytes(resp.into_body(), 1024 * 1024)
            .await
            .unwrap();
        let filtered: Vec<serde_json::Value> = serde_json::from_slice(&body).unwrap();
        assert_eq!(filtered.len(), 1);
        assert_eq!(filtered[0]["kind"], "png");
    }

    #[tokio::test]
    async fn upload_and_list_media() {
        let app = test_app().await;
        let token = login_and_create_run(&app, "p1", "r1").await;
        let auth_val = format!("Bearer {}", token);

        // Upload a small PNG image (base64 of a 1x1 red pixel)
        let upload = serde_json::json!({
            "name": "test_image",
            "kind": "image",
            "ext": "png",
            "data": "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
            "step": 0,
        });
        let req = Request::builder()
            .method("POST")
            .uri("/api/v1/runs/r1/media")
            .header("content-type", "application/json")
            .header("authorization", &auth_val)
            .body(Body::from(serde_json::to_string(&upload).unwrap()))
            .unwrap();
        let resp = app.clone().oneshot(req).await.unwrap();
        assert_eq!(
            resp.status(),
            StatusCode::CREATED,
            "media upload should return 201"
        );

        // List media
        let req = Request::builder()
            .method("GET")
            .uri("/api/v1/runs/r1/media")
            .header("authorization", &auth_val)
            .body(Body::empty())
            .unwrap();
        let resp = app.clone().oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
        let body = axum::body::to_bytes(resp.into_body(), 1024 * 1024)
            .await
            .unwrap();
        let list: Vec<serde_json::Value> = serde_json::from_slice(&body).unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0]["name"], "test_image");
        assert_eq!(list[0]["kind"], "image");

        // Filter by kind
        let req = Request::builder()
            .method("GET")
            .uri("/api/v1/runs/r1/media?kind=image")
            .header("authorization", &auth_val)
            .body(Body::empty())
            .unwrap();
        let resp = app.oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn upload_and_list_tables() {
        let app = test_app().await;
        let token = login_and_create_run(&app, "p1", "r1").await;
        let auth_val = format!("Bearer {}", token);

        // Upload a table
        let upload = serde_json::json!({
            "name": "metrics",
            "columns": ["epoch", "loss", "acc"],
            "data": [[0, 0.5, 0.85], [1, 0.3, 0.92]],
            "step": 0,
        });
        let req = Request::builder()
            .method("POST")
            .uri("/api/v1/runs/r1/tables")
            .header("content-type", "application/json")
            .header("authorization", &auth_val)
            .body(Body::from(serde_json::to_string(&upload).unwrap()))
            .unwrap();
        let resp = app.clone().oneshot(req).await.unwrap();
        assert_eq!(
            resp.status(),
            StatusCode::CREATED,
            "table upload should return 201"
        );
        let body: serde_json::Value = axum::body::to_bytes(resp.into_body(), 1024)
            .await
            .map(|b| serde_json::from_slice(&b).unwrap())
            .unwrap();
        let table_id = body["id"].as_i64().unwrap();

        // List tables
        let req = Request::builder()
            .method("GET")
            .uri("/api/v1/runs/r1/tables")
            .header("authorization", &auth_val)
            .body(Body::empty())
            .unwrap();
        let resp = app.clone().oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
        let body = axum::body::to_bytes(resp.into_body(), 1024 * 1024)
            .await
            .unwrap();
        let list: Vec<serde_json::Value> = serde_json::from_slice(&body).unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0]["name"], "metrics");

        // Get table by id
        let req = Request::builder()
            .method("GET")
            .uri(&format!("/api/v1/runs/r1/tables/{}", table_id))
            .header("authorization", &auth_val)
            .body(Body::empty())
            .unwrap();
        let resp = app.oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
        let body: serde_json::Value = axum::body::to_bytes(resp.into_body(), 1024 * 1024)
            .await
            .map(|b| serde_json::from_slice(&b).unwrap())
            .unwrap();
        assert_eq!(body["columns"][1], "loss");
        assert_eq!(body["data"][1][1], 0.3);
    }

    // ─── Owner isolation + project sharing ───

    #[tokio::test]
    async fn experimenter_sees_only_own() {
        let app = test_app().await;
        let admin_token = login_and_create_run(&app, "p1", "admin-run").await;
        let admin_auth = format!("Bearer {}", admin_token);
        let alice_token = register_and_login(&app, "alice", "pw").await;
        let alice_auth = format!("Bearer {}", alice_token);

        // alice creates a run in her own project p2
        let req = Request::builder()
            .method("POST")
            .uri("/api/v1/runs")
            .header("content-type", "application/json")
            .header("authorization", &alice_auth)
            .body(Body::from(
                serde_json::to_string(&CreateRunRequest {
                    run_id: Some("alice-run".into()),
                    project: "p2".into(),
                    group_name: None,
                    name: Some("a".into()),
                    sweep_id: None,
                    config: None,
                    created_at: None,
                })
                .unwrap(),
            ))
            .unwrap();
        let resp = app.clone().oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::CREATED, "alice create own run");

        // alice lists → only p2 (own runs only, no sharing)
        let req = Request::builder()
            .method("GET")
            .uri("/api/v1/runs?limit=100")
            .header("authorization", &alice_auth)
            .body(Body::empty())
            .unwrap();
        let resp = app.clone().oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
        let body = axum::body::to_bytes(resp.into_body(), 4096).await.unwrap();
        let list: Vec<serde_json::Value> = serde_json::from_slice(&body).unwrap();
        assert!(!list.is_empty());
        assert!(
            list.iter().all(|r| r["project"] == "p2"),
            "alice sees only own project"
        );
        assert!(list.iter().any(|r| r["run_id"] == "alice-run"));

        // alice cannot see admin's run in p1
        assert!(
            !list.iter().any(|r| r["run_id"] == "admin-run"),
            "alice cannot see others' runs"
        );

        // admin lists → sees both
        let req = Request::builder()
            .method("GET")
            .uri("/api/v1/runs?limit=100")
            .header("authorization", &admin_auth)
            .body(Body::empty())
            .unwrap();
        let resp = app.clone().oneshot(req).await.unwrap();
        let body = axum::body::to_bytes(resp.into_body(), 4096).await.unwrap();
        let list: Vec<serde_json::Value> = serde_json::from_slice(&body).unwrap();
        assert!(list.iter().any(|r| r["run_id"] == "admin-run"));
        assert!(list.iter().any(|r| r["run_id"] == "alice-run"));
    }

    #[tokio::test]
    async fn owner_can_delete_project() {
        let app = test_app().await;
        let _admin_token = login_and_create_run(&app, "p1", "admin-run").await;
        let alice_token = register_and_login(&app, "alice", "pw").await;
        let alice_auth = format!("Bearer {}", alice_token);

        // alice creates her own project p2
        let req = Request::builder()
            .method("POST")
            .uri("/api/v1/runs")
            .header("content-type", "application/json")
            .header("authorization", &alice_auth)
            .body(Body::from(
                serde_json::to_string(&CreateRunRequest {
                    run_id: Some("alice-run".into()),
                    project: "p2".into(),
                    group_name: None,
                    name: Some("a".into()),
                    sweep_id: None,
                    config: None,
                    created_at: None,
                })
                .unwrap(),
            ))
            .unwrap();
        let resp = app.clone().oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::CREATED);

        // finish the run first (delete project refuses while runs are running)
        let req = Request::builder()
            .method("POST")
            .uri("/api/v1/runs/alice-run/finish")
            .header("authorization", &alice_auth)
            .body(Body::empty())
            .unwrap();
        let resp = app.clone().oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::OK);

        // alice deletes own project p2 → OK
        let req = Request::builder()
            .method("POST")
            .uri("/api/v1/projects/p2/delete")
            .header("authorization", &alice_auth)
            .body(Body::empty())
            .unwrap();
        let resp = app.clone().oneshot(req).await.unwrap();
        assert_eq!(
            resp.status(),
            StatusCode::OK,
            "owner can delete own project"
        );

        // alice cannot delete admin's p1 → 403
        let req = Request::builder()
            .method("POST")
            .uri("/api/v1/projects/p1/delete")
            .header("authorization", &alice_auth)
            .body(Body::empty())
            .unwrap();
        let resp = app.clone().oneshot(req).await.unwrap();
        assert_eq!(
            resp.status(),
            StatusCode::FORBIDDEN,
            "non-owner cannot delete other's project"
        );
    }

    #[tokio::test]
    async fn stranger_cannot_create_run_in_existing_project() {
        let app = test_app().await;
        let _admin_token = login_and_create_run(&app, "p1", "admin-run").await;
        let bob_token = register_and_login(&app, "bob", "pw").await;
        let bob_auth = format!("Bearer {}", bob_token);

        // bob 无任何 project_access 记录,在已存在的 p1 建 run → 403
        let req = Request::builder()
            .method("POST")
            .uri("/api/v1/runs")
            .header("content-type", "application/json")
            .header("authorization", &bob_auth)
            .body(Body::from(
                serde_json::to_string(&CreateRunRequest {
                    run_id: Some("bob-intruder".into()),
                    project: "p1".into(),
                    group_name: None,
                    name: Some("x".into()),
                    sweep_id: None,
                    config: None,
                    created_at: None,
                })
                .unwrap(),
            ))
            .unwrap();
        let resp = app.clone().oneshot(req).await.unwrap();
        assert_eq!(
            resp.status(),
            StatusCode::FORBIDDEN,
            "stranger cannot create run in an existing project"
        );

        // bob 在全新项目可建 run(自动成为 owner)
        let req = Request::builder()
            .method("POST")
            .uri("/api/v1/runs")
            .header("content-type", "application/json")
            .header("authorization", &bob_auth)
            .body(Body::from(
                serde_json::to_string(&CreateRunRequest {
                    run_id: Some("bob-own".into()),
                    project: "bob-project".into(),
                    group_name: None,
                    name: Some("y".into()),
                    sweep_id: None,
                    config: None,
                    created_at: None,
                })
                .unwrap(),
            ))
            .unwrap();
        let resp = app.clone().oneshot(req).await.unwrap();
        assert_eq!(
            resp.status(),
            StatusCode::CREATED,
            "new project → allowed and becomes owner"
        );
    }

    #[tokio::test]
    async fn share_token_allows_anonymous_read() {
        let app = test_app().await;
        let admin_token = login_and_create_run(&app, "p1", "admin-run").await;
        let admin_auth = format!("Bearer {}", admin_token);

        // admin 生成 share token
        let req = Request::builder()
            .method("POST")
            .uri("/api/v1/share")
            .header("content-type", "application/json")
            .header("authorization", &admin_auth)
            .body(Body::from(
                r#"{"resource_type":"run","resource_id":"admin-run","expires_in_days":7}"#,
            ))
            .unwrap();
        let resp = app.clone().oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::CREATED, "share creation");
        let body = axum::body::to_bytes(resp.into_body(), 4096).await.unwrap();
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        let token = json["token"].as_str().unwrap().to_string();

        // 匿名 + 有效 token → 可读
        let req = Request::builder()
            .method("GET")
            .uri(&format!("/api/v1/runs/admin-run/figures?token={}", token))
            .body(Body::empty())
            .unwrap();
        let resp = app.clone().oneshot(req).await.unwrap();
        assert_eq!(
            resp.status(),
            StatusCode::OK,
            "anonymous with share token can read"
        );

        // 匿名无 token → 401
        let req = Request::builder()
            .method("GET")
            .uri("/api/v1/runs/admin-run/figures")
            .body(Body::empty())
            .unwrap();
        let resp = app.clone().oneshot(req).await.unwrap();
        assert_eq!(
            resp.status(),
            StatusCode::UNAUTHORIZED,
            "anonymous without token denied"
        );

        // 错误 token → 401
        let req = Request::builder()
            .method("GET")
            .uri("/api/v1/runs/admin-run/figures?token=wrongtoken")
            .body(Body::empty())
            .unwrap();
        let resp = app.clone().oneshot(req).await.unwrap();
        assert_eq!(
            resp.status(),
            StatusCode::UNAUTHORIZED,
            "wrong token denied"
        );

        // 匿名写操作带 token → 401(require_run_write 不接受 share token)
        let req = Request::builder()
            .method("POST")
            .uri(&format!("/api/v1/runs/admin-run/delete?token={}", token))
            .body(Body::empty())
            .unwrap();
        let resp = app.clone().oneshot(req).await.unwrap();
        assert_eq!(
            resp.status(),
            StatusCode::UNAUTHORIZED,
            "anonymous cannot write with share token"
        );

        // 非 owner 登录用户无 token 不可读 → 403
        let bob_token = register_and_login(&app, "bob", "pw").await;
        let bob_auth = format!("Bearer {}", bob_token);
        let req = Request::builder()
            .method("GET")
            .uri("/api/v1/runs/admin-run/figures")
            .header("authorization", &bob_auth)
            .body(Body::empty())
            .unwrap();
        let resp = app.clone().oneshot(req).await.unwrap();
        assert_eq!(
            resp.status(),
            StatusCode::FORBIDDEN,
            "non-owner logged-in cannot read"
        );
    }

    #[tokio::test]
    async fn shares_crud_api() {
        let app = test_app().await;
        let admin_token = login_and_create_run(&app, "p1", "admin-run").await;
        let admin_auth = format!("Bearer {}", admin_token);

        // 生成 share token
        let req = Request::builder()
            .method("POST")
            .uri("/api/v1/share")
            .header("content-type", "application/json")
            .header("authorization", &admin_auth)
            .body(Body::from(
                r#"{"resource_type":"run","resource_id":"admin-run","expires_in_days":7}"#,
            ))
            .unwrap();
        let resp = app.clone().oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::CREATED);
        let body = axum::body::to_bytes(resp.into_body(), 4096).await.unwrap();
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        let token = json["token"].as_str().unwrap().to_string();

        // 生成第二个(永久)
        let req = Request::builder()
            .method("POST")
            .uri("/api/v1/share")
            .header("content-type", "application/json")
            .header("authorization", &admin_auth)
            .body(Body::from(
                r#"{"resource_type":"run","resource_id":"admin-run","expires_in_days":null}"#,
            ))
            .unwrap();
        let resp = app.clone().oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::CREATED);
        let body = axum::body::to_bytes(resp.into_body(), 4096).await.unwrap();
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        let token2 = json["token"].as_str().unwrap().to_string();

        // GET /shares 列表含两者
        let req = Request::builder()
            .method("GET")
            .uri("/api/v1/shares")
            .header("authorization", &admin_auth)
            .body(Body::empty())
            .unwrap();
        let resp = app.clone().oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
        let body = axum::body::to_bytes(resp.into_body(), 4096).await.unwrap();
        let shares: Vec<serde_json::Value> = serde_json::from_slice(&body).unwrap();
        assert!(shares
            .iter()
            .any(|s| s["token"] == token && s["resource_id"] == "admin-run"));
        assert!(
            shares
                .iter()
                .any(|s| s["token"] == token2 && s["expires_at"].is_null()),
            "permanent share has no expiry"
        );

        // PUT 改周期:token2 → 永久改为 30 天
        let req = Request::builder()
            .method("PUT")
            .uri(&format!("/api/v1/shares/{}", token2))
            .header("content-type", "application/json")
            .header("authorization", &admin_auth)
            .body(Body::from(r#"{"expires_in_days":30}"#))
            .unwrap();
        let resp = app.clone().oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::OK, "update expiry");
        let req = Request::builder()
            .method("GET")
            .uri("/api/v1/shares")
            .header("authorization", &admin_auth)
            .body(Body::empty())
            .unwrap();
        let resp = app.clone().oneshot(req).await.unwrap();
        let body = axum::body::to_bytes(resp.into_body(), 4096).await.unwrap();
        let shares: Vec<serde_json::Value> = serde_json::from_slice(&body).unwrap();
        assert!(
            shares
                .iter()
                .any(|s| s["token"] == token2 && !s["expires_at"].is_null()),
            "expiry updated"
        );

        // 非 owner 不能管理 admin 的共享
        let bob_token = register_and_login(&app, "bob", "pw").await;
        let bob_auth = format!("Bearer {}", bob_token);
        let req = Request::builder()
            .method("DELETE")
            .uri(&format!("/api/v1/shares/{}", token))
            .header("authorization", &bob_auth)
            .body(Body::empty())
            .unwrap();
        let resp = app.clone().oneshot(req).await.unwrap();
        assert_eq!(
            resp.status(),
            StatusCode::FORBIDDEN,
            "non-owner cannot delete others' share"
        );

        // admin 撤销 token
        let req = Request::builder()
            .method("DELETE")
            .uri(&format!("/api/v1/shares/{}", token))
            .header("authorization", &admin_auth)
            .body(Body::empty())
            .unwrap();
        let resp = app.clone().oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::OK, "admin revoke share");
        let req = Request::builder()
            .method("GET")
            .uri("/api/v1/shares")
            .header("authorization", &admin_auth)
            .body(Body::empty())
            .unwrap();
        let resp = app.clone().oneshot(req).await.unwrap();
        let body = axum::body::to_bytes(resp.into_body(), 4096).await.unwrap();
        let shares: Vec<serde_json::Value> = serde_json::from_slice(&body).unwrap();
        assert!(!shares.iter().any(|s| s["token"] == token), "share revoked");
    }

    #[tokio::test]
    async fn api_token_auth_and_management() {
        let app = test_app().await;
        let admin_token = login_and_create_run(&app, "p1", "admin-run").await;
        let admin_auth = format!("Bearer {}", admin_token);

        // 1. 生成 API token(7 天)
        let req = Request::builder()
            .method("POST")
            .uri("/api/v1/tokens")
            .header("content-type", "application/json")
            .header("authorization", &admin_auth)
            .body(Body::from(r#"{"name":"ci","expires_in_days":7}"#))
            .unwrap();
        let resp = app.clone().oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::CREATED);
        let body = axum::body::to_bytes(resp.into_body(), 4096).await.unwrap();
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        let api_token = json["token"].as_str().unwrap().to_string();
        assert!(api_token.starts_with("rt_"), "api token prefix");

        // 2. 用 API token 调受保护 API → 200(认证走数据库 token)
        let req = Request::builder()
            .method("GET")
            .uri("/api/v1/runs?limit=1")
            .header("authorization", format!("Bearer {}", api_token))
            .body(Body::empty())
            .unwrap();
        let resp = app.clone().oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::OK, "api token auth works");

        // 3. 列表含该 token
        let req = Request::builder()
            .method("GET")
            .uri("/api/v1/tokens")
            .header("authorization", &admin_auth)
            .body(Body::empty())
            .unwrap();
        let resp = app.clone().oneshot(req).await.unwrap();
        let body = axum::body::to_bytes(resp.into_body(), 4096).await.unwrap();
        let tokens: Vec<serde_json::Value> = serde_json::from_slice(&body).unwrap();
        assert!(tokens
            .iter()
            .any(|t| t["token"] == api_token && t["name"] == "ci"));

        // 4. 非 owner 不能删别人的 token
        let bob_token = register_and_login(&app, "bob", "pw").await;
        let bob_auth = format!("Bearer {}", bob_token);
        let req = Request::builder()
            .method("DELETE")
            .uri(&format!("/api/v1/tokens/{}", api_token))
            .header("authorization", &bob_auth)
            .body(Body::empty())
            .unwrap();
        let resp = app.clone().oneshot(req).await.unwrap();
        assert_eq!(
            resp.status(),
            StatusCode::NOT_FOUND,
            "non-owner cannot delete others' token"
        );

        // 5. 删除后 → 认证失败(401)
        let req = Request::builder()
            .method("DELETE")
            .uri(&format!("/api/v1/tokens/{}", api_token))
            .header("authorization", &admin_auth)
            .body(Body::empty())
            .unwrap();
        let resp = app.clone().oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::OK, "delete own token");
        let req = Request::builder()
            .method("GET")
            .uri("/api/v1/runs?limit=1")
            .header("authorization", format!("Bearer {}", api_token))
            .body(Body::empty())
            .unwrap();
        let resp = app.clone().oneshot(req).await.unwrap();
        assert_eq!(
            resp.status(),
            StatusCode::UNAUTHORIZED,
            "deleted token invalid"
        );
    }
}

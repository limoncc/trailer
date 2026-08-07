mod auth;
mod config;
pub mod error;
mod routes;
#[cfg(feature = "embed-frontend")]
mod embedded;

use crate::auth::AuthState;
use axum::extract::State;
use axum::http::{header, StatusCode, Uri};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::Router;
use config::AppConfig;
use routes::{AppState, LttbCache};
use std::sync::Arc;
use std::time::Duration;
use tokio::signal;
use tokio::sync::{broadcast, mpsc, Mutex};
use tower_http::cors::CorsLayer;
use tower_http::trace::{DefaultMakeSpan, DefaultOnResponse, TraceLayer};
use tracing::Level;
use trailer_core::ingest::run_ingestion_writer_with_taps;
use trailer_core::run_manager::RunManager;
use trailer_core::storage::new_sqlite_storage;
use trailer_core::taps::{SseTap, SummaryTap};

#[tokio::main]
async fn main() {
    let cfg = AppConfig::load();
    // 持有 WorkerGuard, 保证文件日志 worker 线程存活(否则日志滞留通道被丢弃)
    let _log_guard = config::init_tracing(&cfg.log_dir);

    // Storage — explicit storage kind, or auto-detect PostgreSQL vs SQLite
    let store: Arc<dyn trailer_core::storage::Storage> = match cfg.storage.as_deref() {
        Some("file") => trailer_core::storage::new_file_storage(&cfg.data_dir)
            .await
            .expect("Failed to open file storage"),
        Some("pg") => {
            #[cfg(not(feature = "pg"))]
            {
                panic!("PostgreSQL support requires --features pg at compile time");
            }
            #[cfg(feature = "pg")]
            {
                open_pg_or_hint(&cfg.database_url).await
            }
        }
        Some("sqlite") => new_sqlite_storage(&cfg.database_url)
            .await
            .expect("Failed to open database"),
        _ => {
            if cfg.database_url.starts_with("postgres://")
                || cfg.database_url.starts_with("postgresql://")
            {
                #[cfg(not(feature = "pg"))]
                {
                    panic!("PostgreSQL support requires --features pg at compile time");
                }
                #[cfg(feature = "pg")]
                {
                    open_pg_or_hint(&cfg.database_url).await
                }
            } else {
                new_sqlite_storage(&cfg.database_url)
                    .await
                    .expect("Failed to open database")
            }
        }
    };

    // Ingestion channel
    let (tx, rx) = mpsc::channel::<Vec<trailer_core::domain::Envelope>>(10_000);
    let ingest_tx = Arc::new(tx);

    // Run manager
    let run_mgr = Arc::new(RunManager::new(store.clone(), Duration::from_secs(60)));

    // Auth (DB-backed)
    let auth = Arc::new(Mutex::new(AuthState::new(store.clone()).await));

    // SSE broadcast channel + taps
    let (sse_tx, _) = broadcast::channel(2048);
    let sse_tap = SseTap::new(sse_tx.clone());
    let summary_tap = SummaryTap::new(store.clone());

    // Spawn writer background task with SSE + Summary taps
    let writer_store = store.clone();
    tokio::spawn(async move {
        run_ingestion_writer_with_taps(
            rx,
            writer_store,
            vec![Box::new(summary_tap), Box::new(sse_tap)],
        )
        .await;
    });

    // Heartbeat timeout checker:mark 意外中断(心跳停止)的 run 为 crashed
    let check_mgr = run_mgr.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(30));
        loop {
            interval.tick().await;
            match check_mgr.check_timeouts().await {
                Ok(crashed) if crashed > 0 => {
                    tracing::warn!(crashed, "runs timed out and marked crashed");
                }
                Ok(_) => {}
                Err(e) => tracing::warn!("check_timeouts failed: {e}"),
            }
        }
    });

    let state = AppState {
        ingest_tx,
        store: store.clone(),
        run_manager: run_mgr,
        sse_tx,
        artifacts_dir: cfg.artifacts_dir.clone().into(),
        frontend_dir: cfg.frontend_dir.clone().into(),
        lttb_cache: Arc::new(Mutex::new(LttbCache::new(10, 500))),
        auth,
    };

    // Build router
    let app = Router::new()
        .merge(routes::router())
        .fallback(get(frontend_fallback))
        // 允许跨源访问(dev 5173 → server、localhost/127.0.0.1 互访),本地工具 permissive
        .layer(CorsLayer::permissive())
        // HTTP 请求访问日志(方法/路径/状态码/耗时);放最外层以覆盖 CORS preflight
        .layer(
            TraceLayer::new_for_http()
                .make_span_with(DefaultMakeSpan::new().level(Level::INFO))
                .on_response(DefaultOnResponse::new().level(Level::INFO)),
        )
        .with_state(state);

    let addr = format!("{}:{}", cfg.host, cfg.port);
    tracing::info!(%addr, "Trailer Server starting");

    let listener = tokio::net::TcpListener::bind(&addr).await.unwrap();
    tracing::info!("Press Ctrl+C to stop");
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await
        .unwrap();
}

/// Wait for SIGINT (Ctrl+C) or SIGTERM
async fn shutdown_signal() {
    let ctrl_c = async {
        signal::ctrl_c()
            .await
            .expect("failed to install Ctrl+C handler");
    };

    #[cfg(unix)]
    let terminate = async {
        signal::unix::signal(signal::unix::SignalKind::terminate())
            .expect("failed to install signal handler")
            .recv()
            .await;
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => {},
        _ = terminate => {},
    }
    tracing::info!("Shutting down gracefully...");
}

/// 打开 PostgreSQL 存储;若数据库不存在则打印建库提示后退出。
#[cfg(feature = "pg")]
async fn open_pg_or_hint(url: &str) -> Arc<dyn trailer_core::storage::Storage> {
    match trailer_core::storage::new_pg_storage(url).await {
        Ok(store) => store,
        Err(e) => {
            if let Some(msg) = trailer_core::storage::is_database_missing_error(&e) {
                eprintln!("PostgreSQL database does not exist: {msg}");
                eprintln!();
                eprintln!("Create the empty database first (one-time setup):");
                eprintln!("  psql -U postgres -c \"CREATE DATABASE trailer_db OWNER trailer\"");
                eprintln!("Then re-run trailer-server. Tables are auto-migrated on first start.");
                std::process::exit(1);
            }
            panic!("Failed to open PostgreSQL database: {e}");
        }
    }
}

/// 前端静态文件服务:优先磁盘目录(开发热更新),其次编译时嵌入(feature),否则 404。
async fn frontend_fallback(uri: Uri, State(state): State<AppState>) -> Response {
    let dir = std::path::Path::new(&state.frontend_dir);
    if dir.join("index.html").exists() {
        serve_disk(dir, uri.path()).await
    } else {
        #[cfg(feature = "embed-frontend")]
        {
            embedded::serve(uri.path())
        }
        #[cfg(not(feature = "embed-frontend"))]
        {
            StatusCode::NOT_FOUND.into_response()
        }
    }
}

/// 从磁盘读取前端文件;目录或未知路径 SPA fallback 到 index.html。
async fn serve_disk(dir: &std::path::Path, path: &str) -> Response {
    let rel = path.trim_start_matches('/');
    let candidate = if rel.is_empty() { "index.html" } else { rel };
    let file_path = dir.join(candidate);
    // 防路径穿越
    if !file_path.starts_with(dir) {
        return StatusCode::NOT_FOUND.into_response();
    }
    if let Ok(data) = tokio::fs::read(&file_path).await {
        let mime = mime_guess::from_path(&candidate).first_or_octet_stream();
        return (StatusCode::OK, [(header::CONTENT_TYPE, mime.as_ref())], data).into_response();
    }
    // SPA fallback:未知路径 → index.html
    if let Ok(index) = tokio::fs::read(dir.join("index.html")).await {
        return (StatusCode::OK, [(header::CONTENT_TYPE, "text/html")], index).into_response();
    }
    StatusCode::NOT_FOUND.into_response()
}

#[cfg(test)]
mod tests {
    #[test]
    fn server_compiles() {
        assert_eq!(2 + 2, 4);
    }
}

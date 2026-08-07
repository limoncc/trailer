use clap::Parser;
use serde::Deserialize;
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::util::SubscriberInitExt;

/// Trailer server configuration.
/// Sources (priority: high → low): CLI args > env vars > config file
#[derive(Debug, Clone, Parser, Deserialize)]
#[command(name = "trailer-server", about = "Trailer experiment tracking server")]
pub struct AppConfig {
    /// Database URL (SQLite path or Postgres connection string)
    #[arg(long, env = "TRAILER_DATABASE_URL", default_value = "trailer.db")]
    pub database_url: String,

    /// Storage backend: "sqlite" | "file" | "pg" (default: auto-detect by database_url)
    #[arg(long, env = "TRAILER_STORAGE")]
    pub storage: Option<String>,

    /// File-storage data directory (used when storage=file)
    #[arg(long, env = "TRAILER_DATA_DIR", default_value = "data")]
    pub data_dir: String,

    /// Artifacts directory
    #[arg(long, env = "TRAILER_ARTIFACTS_DIR", default_value = "artifacts")]
    pub artifacts_dir: String,

    /// Frontend static asset directory
    #[arg(long, env = "TRAILER_FRONTEND_DIR", default_value = "trailer-ui/build")]
    pub frontend_dir: String,

    /// Log directory (rolling daily file output)
    #[arg(long, env = "TRAILER_LOG_DIR", default_value = "logs")]
    pub log_dir: String,

    /// Listen address
    #[arg(long, env = "TRAILER_HOST", default_value = "127.0.0.1")]
    pub host: String,

    /// Listen port
    #[arg(long, env = "TRAILER_PORT", default_value = "5120")]
    pub port: u16,

    /// API key for authenticated access (server mode)
    #[arg(long, env = "TRAILER_API_KEY")]
    pub api_key: Option<String>,

    /// Config file path (TOML/YAML)
    #[arg(long)]
    pub config_file: Option<String>,
}

impl AppConfig {
    /// Load config from CLI + env + optional config file
    pub fn load() -> Self {
        let mut cli = Self::parse();

        if let Some(ref path) = cli.config_file {
            if let Ok(config) = config::Config::builder()
                .add_source(config::File::with_name(path))
                .build()
            {
                if let Ok(file_cfg) = config.try_deserialize::<Self>() {
                    cli = Self::merge(cli, file_cfg);
                }
            }
        }
        cli
    }

    /// CLI values take precedence over file values
    fn merge(cli: Self, file: Self) -> Self {
        Self {
            database_url: if cli.database_url != "trailer.db" {
                cli.database_url
            } else {
                file.database_url
            },
            storage: cli.storage.or(file.storage),
            data_dir: if cli.data_dir != "data" {
                cli.data_dir
            } else {
                file.data_dir
            },
            artifacts_dir: if cli.artifacts_dir != "artifacts" {
                cli.artifacts_dir
            } else {
                file.artifacts_dir
            },
            frontend_dir: if cli.frontend_dir != "trailer-ui/build" {
                cli.frontend_dir
            } else {
                file.frontend_dir
            },
            log_dir: if cli.log_dir != "logs" {
                cli.log_dir
            } else {
                file.log_dir
            },
            host: if cli.host != "127.0.0.1" {
                cli.host
            } else {
                file.host
            },
            port: if cli.port != 5120 {
                cli.port
            } else {
                file.port
            },
            api_key: cli.api_key.or(file.api_key),
            config_file: cli.config_file.or(file.config_file),
        }
    }
}

/// Initialize structured logging:
/// - stdout (human-readable, keeps previous style)
/// - rolling daily file at `log_dir`/trailer-server.log.* (deployment retention)
///
/// Level defaults to **info**; control with `RUST_LOG` (e.g. debug / warn).
/// Returns a `WorkerGuard` — must be held for the process lifetime, otherwise
/// the non-blocking file writer stops draining.
pub fn init_tracing(log_dir: &str) -> tracing_appender::non_blocking::WorkerGuard {
    // 默认开启 info; 可用 RUST_LOG 调高(debug)/调低(warn)
    let filter = tracing_subscriber::EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info"));

    std::fs::create_dir_all(log_dir).expect("failed to create log directory");

    // 按天轮转文件 + non_blocking(不阻塞 async 运行时)
    let file_appender = tracing_appender::rolling::daily(log_dir, "trailer-server.log");
    let (file_writer, file_guard) = tracing_appender::non_blocking(file_appender);

    let stdout_layer = tracing_subscriber::fmt::layer().with_target(false);
    let file_layer = tracing_subscriber::fmt::layer()
        .with_target(true) // 文件里保留 target, 便于定位模块
        .with_ansi(false)
        .with_writer(file_writer);

    tracing_subscriber::registry()
        .with(filter)
        .with(stdout_layer)
        .with(file_layer)
        .init();

    file_guard
}

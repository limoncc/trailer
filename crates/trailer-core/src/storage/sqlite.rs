use async_trait::async_trait;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePool, SqlitePoolOptions};
use sqlx::Row;
use std::str::FromStr;

use crate::domain::{
    ApiToken, ArtifactMeta, ExploreRow, FigureRow, HistogramRow, MediaRow, MetricQuery, MetricRow,
    ReportRow, RunFilter, RunMeta, ShareInfo, SummaryRow, TableRow, TextRow, UserRow,
};
use crate::error::{StorageError, StorageResult};
use crate::storage::Storage;

pub struct SqliteStorage {
    pool: SqlitePool,
}

impl SqliteStorage {
    pub async fn open(path: &str) -> StorageResult<Self> {
        let opts = SqliteConnectOptions::from_str(path)
            .map_err(|e| StorageError::Database(sqlx::Error::Protocol(e.to_string())))?
            .create_if_missing(true)
            .journal_mode(sqlx::sqlite::SqliteJournalMode::Wal)
            .synchronous(sqlx::sqlite::SqliteSynchronous::Normal)
            .foreign_keys(true);
        let pool = SqlitePoolOptions::new()
            .max_connections(5)
            .connect_with(opts)
            .await?;

        // Performance PRAGMAs (best-effort — WAL may fail on some filesystems)
        let _ = sqlx::query("PRAGMA journal_mode = WAL")
            .execute(&pool)
            .await;
        let _ = sqlx::query("PRAGMA synchronous = NORMAL")
            .execute(&pool)
            .await;
        let _ = sqlx::query("PRAGMA foreign_keys = ON").execute(&pool).await;

        let _ = sqlx::query("PRAGMA foreign_keys = ON").execute(&pool).await;
        let store = Self { pool };
        store.run_migrations().await?;
        Ok(store)
    }

    async fn run_migrations(&self) -> StorageResult<()> {
        sqlx::query(
            "CREATE TABLE IF NOT EXISTS runs (
                run_id       TEXT PRIMARY KEY,
                project      TEXT NOT NULL,
                group_name   TEXT,
                name         TEXT,
                state        TEXT NOT NULL DEFAULT 'running',
                config       TEXT NOT NULL DEFAULT '{}',
                env          TEXT NOT NULL DEFAULT '{}',
                git_commit   TEXT,
                sweep_id     TEXT,
                created_at   REAL NOT NULL,
                heartbeat_at REAL,
                tags         TEXT DEFAULT '[]',
                owner_id     INTEGER
            )",
        )
        .execute(&self.pool)
        .await?;

        sqlx::query(
            "CREATE TABLE IF NOT EXISTS metrics (
                run_id    TEXT NOT NULL,
                step      BIGINT NOT NULL,
                wall_time REAL NOT NULL,
                key       TEXT NOT NULL,
                context   TEXT NOT NULL DEFAULT '',
                value     REAL NOT NULL
            )",
        )
        .execute(&self.pool)
        .await?;

        sqlx::query(
            "CREATE INDEX IF NOT EXISTS idx_metrics_run_key ON metrics(run_id, key, context, step)",
        )
        .execute(&self.pool)
        .await?;

        sqlx::query(
            "CREATE TABLE IF NOT EXISTS histograms (
                run_id        TEXT NOT NULL,
                step          BIGINT NOT NULL,
                wall_time     REAL NOT NULL,
                key           TEXT NOT NULL,
                context       TEXT NOT NULL DEFAULT '',
                bucket_limits TEXT NOT NULL DEFAULT '[]',
                bucket_counts TEXT NOT NULL DEFAULT '[]',
                min           REAL NOT NULL,
                max           REAL NOT NULL,
                num           BIGINT NOT NULL,
                sum           REAL NOT NULL,
                sum_squares   REAL NOT NULL
            )",
        )
        .execute(&self.pool)
        .await?;

        sqlx::query(
            "CREATE INDEX IF NOT EXISTS idx_histograms_run_key ON histograms(run_id, key, context, step)"
        ).execute(&self.pool).await?;

        sqlx::query(
            "CREATE TABLE IF NOT EXISTS run_summary (
                run_id    TEXT NOT NULL,
                key       TEXT NOT NULL,
                context   TEXT NOT NULL DEFAULT '',
                last      REAL,
                best      REAL,
                best_step BIGINT,
                min_val   REAL,
                max_val   REAL,
                user_val  REAL,
                PRIMARY KEY (run_id, key, context)
            )",
        )
        .execute(&self.pool)
        .await?;

        sqlx::query(
            "CREATE TABLE IF NOT EXISTS texts (
                run_id TEXT NOT NULL, step BIGINT NOT NULL,
                name TEXT NOT NULL, body TEXT NOT NULL
            )",
        )
        .execute(&self.pool)
        .await?;

        sqlx::query(
            "CREATE TABLE IF NOT EXISTS figures (
                run_id TEXT NOT NULL, step BIGINT NOT NULL,
                name TEXT NOT NULL, kind TEXT NOT NULL,
                body TEXT NOT NULL
            )",
        )
        .execute(&self.pool)
        .await?;

        sqlx::query(
            "CREATE TABLE IF NOT EXISTS trailer_users (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                username   TEXT UNIQUE NOT NULL,
                password   TEXT NOT NULL,
                role       TEXT NOT NULL DEFAULT 'experimenter',
                created_at REAL NOT NULL,
                theme      TEXT NOT NULL DEFAULT '{}'
            )",
        )
        .execute(&self.pool)
        .await?;
        // 兼容旧库:补 theme 列(若已存在则忽略)
        let _ =
            sqlx::query("ALTER TABLE trailer_users ADD COLUMN theme TEXT NOT NULL DEFAULT '{}'")
                .execute(&self.pool)
                .await;

        // 迁移:旧版 reports 表 id 为 INTEGER,重建为 TEXT(旧数据删除)
        {
            let old: i64 = sqlx::query(
                "SELECT COUNT(*) FROM pragma_table_info('reports') WHERE name='id' AND type LIKE '%INT%'"
            ).fetch_one(&self.pool).await?.get(0);
            if old > 0 {
                sqlx::query("DROP TABLE reports")
                    .execute(&self.pool)
                    .await?;
            }
        }
        sqlx::query(
            "CREATE TABLE IF NOT EXISTS reports (
                id         TEXT PRIMARY KEY,
                owner_id   INTEGER,
                project    TEXT NOT NULL,
                title      TEXT NOT NULL,
                body       TEXT NOT NULL,
                created_at REAL NOT NULL
            )",
        )
        .execute(&self.pool)
        .await?;

        // 迁移:旧版 explores 表 id 为 INTEGER,重建为 TEXT(旧数据删除)
        {
            let old: i64 = sqlx::query(
                "SELECT COUNT(*) FROM pragma_table_info('explores') WHERE name='id' AND type LIKE '%INT%'"
            ).fetch_one(&self.pool).await?.get(0);
            if old > 0 {
                sqlx::query("DROP TABLE explores")
                    .execute(&self.pool)
                    .await?;
            }
        }
        sqlx::query(
            "CREATE TABLE IF NOT EXISTS explores (
                id          TEXT PRIMARY KEY,
                owner_id    INTEGER NOT NULL,
                project     TEXT NOT NULL DEFAULT '',
                title       TEXT NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                run_ids     TEXT NOT NULL,
                chart_defs  TEXT NOT NULL,
                config      TEXT NOT NULL DEFAULT '{}',
                created_at  REAL NOT NULL,
                updated_at  REAL NOT NULL
            )",
        )
        .execute(&self.pool)
        .await?;

        sqlx::query(
            "CREATE TABLE IF NOT EXISTS tables (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                run_id     TEXT NOT NULL,
                step       BIGINT NOT NULL,
                name       TEXT NOT NULL,
                columns    TEXT NOT NULL,
                data       TEXT NOT NULL,
                row_count  BIGINT NOT NULL,
                created_at REAL NOT NULL
            )",
        )
        .execute(&self.pool)
        .await?;

        sqlx::query(
            "CREATE TABLE IF NOT EXISTS media (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                run_id     TEXT NOT NULL,
                step       BIGINT NOT NULL,
                name       TEXT NOT NULL,
                kind       TEXT NOT NULL,
                ext        TEXT NOT NULL,
                hash       TEXT NOT NULL,
                file_path  TEXT NOT NULL,
                size       BIGINT NOT NULL,
                created_at REAL NOT NULL
            )",
        )
        .execute(&self.pool)
        .await?;

        sqlx::query(
            "CREATE TABLE IF NOT EXISTS artifacts (
                id        INTEGER PRIMARY KEY AUTOINCREMENT,
                run_id    TEXT NOT NULL,
                step      BIGINT,
                name      TEXT NOT NULL,
                kind      TEXT NOT NULL,
                hash      TEXT NOT NULL,
                rel_path  TEXT NOT NULL,
                size      BIGINT,
                created_at REAL,
                UNIQUE(run_id, name, step, hash)
            )",
        )
        .execute(&self.pool)
        .await?;

        sqlx::query(
            "CREATE TABLE IF NOT EXISTS shares (
                token         TEXT PRIMARY KEY,
                resource_type TEXT NOT NULL,
                resource_id   TEXT NOT NULL,
                created_at    REAL NOT NULL,
                expires_at    REAL
            )",
        )
        .execute(&self.pool)
        .await?;

        sqlx::query(
            "CREATE TABLE IF NOT EXISTS api_tokens (
                token      TEXT PRIMARY KEY,
                user_id    INTEGER NOT NULL,
                name       TEXT,
                created_at REAL NOT NULL,
                expires_at REAL
            )",
        )
        .execute(&self.pool)
        .await?;
        sqlx::query("CREATE INDEX IF NOT EXISTS idx_api_tokens_user ON api_tokens(user_id)")
            .execute(&self.pool)
            .await?;

        Ok(())
    }
}

#[async_trait]
impl Storage for SqliteStorage {
    async fn insert_metrics(&self, records: &[MetricRow]) -> StorageResult<()> {
        let mut tx = self.pool.begin().await?;
        for rec in records {
            sqlx::query(
                "INSERT INTO metrics (run_id, step, wall_time, key, context, value)
                 VALUES (?, ?, ?, ?, ?, ?)",
            )
            .bind(&rec.run_id)
            .bind(rec.step)
            .bind(rec.wall_time)
            .bind(&rec.key)
            .bind(&rec.context)
            .bind(rec.value)
            .execute(&mut *tx)
            .await?;
        }
        tx.commit().await?;
        Ok(())
    }

    async fn query_metrics(&self, q: &MetricQuery) -> StorageResult<Vec<MetricRow>> {
        let rows = sqlx::query(
            "SELECT run_id, step, wall_time, key, context, value FROM (
                SELECT run_id, step, wall_time, key, context, value,
                       ROW_NUMBER() OVER (PARTITION BY key, context ORDER BY step ASC) AS rn,
                       COUNT(*) OVER (PARTITION BY key, context) AS total
                FROM metrics
                WHERE (?1 IS NULL OR run_id = ?1)
                  AND (?2 IS NULL OR key = ?2)
                  AND (?3 IS NULL OR context = ?3)
                  AND (?4 IS NULL OR step > ?4 OR key LIKE 'system/%')
             ) WHERE total <= ?5
                OR rn = total
                OR (rn - 1) % ((total + ?5 - 1) / ?5) = 0
             ORDER BY step ASC",
        )
        .bind(&q.run_id)
        .bind(&q.key)
        .bind(&q.context)
        .bind(q.after_step)
        // 每 (key, context) 均匀采样到 q.max_points 个点(首/尾/每 k 个, k=ceil(total/max)),
        // 避免全量读取且不截断历史(训练曲线从头到尾完整)
        .bind(q.max_points.unwrap_or(100_000) as i64)
        .fetch_all(&self.pool)
        .await?;

        Ok(rows
            .iter()
            .map(|r| MetricRow {
                run_id: r.get("run_id"),
                step: r.get("step"),
                wall_time: r.get("wall_time"),
                key: r.get("key"),
                context: r.get("context"),
                value: r.get("value"),
            })
            .collect())
    }

    async fn get_max_step(&self, run_id: &str) -> StorageResult<Option<i64>> {
        let row: Option<(i64,)> =
            sqlx::query_as("SELECT COALESCE(MAX(step), 0) FROM metrics WHERE run_id = ?")
                .bind(run_id)
                .fetch_optional(&self.pool)
                .await?;
        Ok(row.map(|r| r.0).filter(|&v| v > 0))
    }

    async fn delete_metrics_for_run(&self, run_id: &str) -> StorageResult<()> {
        sqlx::query("DELETE FROM metrics WHERE run_id = ?")
            .bind(run_id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    async fn insert_histograms(&self, records: &[HistogramRow]) -> StorageResult<()> {
        let mut tx = self.pool.begin().await?;
        for rec in records {
            let limits_json = serde_json::to_string(&rec.bucket_limits).unwrap_or_default();
            let counts_json = serde_json::to_string(&rec.bucket_counts).unwrap_or_default();
            sqlx::query(
                "INSERT INTO histograms (run_id, step, wall_time, key, context,
                 bucket_limits, bucket_counts, min, max, num, sum, sum_squares)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(&rec.run_id)
            .bind(rec.step)
            .bind(rec.wall_time)
            .bind(&rec.key)
            .bind(&rec.context)
            .bind(&limits_json)
            .bind(&counts_json)
            .bind(rec.min)
            .bind(rec.max)
            .bind(rec.num)
            .bind(rec.sum)
            .bind(rec.sum_squares)
            .execute(&mut *tx)
            .await?;
        }
        tx.commit().await?;
        Ok(())
    }

    async fn query_histograms(
        &self,
        run_id: &str,
        key: Option<&str>,
        context: Option<&str>,
    ) -> StorageResult<Vec<HistogramRow>> {
        let rows = sqlx::query(
            "SELECT run_id, step, wall_time, key, context,
                    bucket_limits, bucket_counts, min, max, num, sum, sum_squares
             FROM histograms
             WHERE run_id = ?1
               AND (?2 IS NULL OR key = ?2)
               AND (?3 IS NULL OR context = ?3)
             ORDER BY step ASC",
        )
        .bind(run_id)
        .bind(key)
        .bind(context)
        .fetch_all(&self.pool)
        .await?;

        Ok(rows
            .iter()
            .map(|r| HistogramRow {
                run_id: r.get("run_id"),
                step: r.get("step"),
                wall_time: r.get("wall_time"),
                key: r.get("key"),
                context: r.get("context"),
                bucket_limits: serde_json::from_str(r.get::<&str, _>("bucket_limits"))
                    .unwrap_or_default(),
                bucket_counts: serde_json::from_str(r.get::<&str, _>("bucket_counts"))
                    .unwrap_or_default(),
                min: r.get("min"),
                max: r.get("max"),
                num: r.get("num"),
                sum: r.get("sum"),
                sum_squares: r.get("sum_squares"),
            })
            .collect())
    }

    async fn delete_histograms_for_run(&self, run_id: &str) -> StorageResult<()> {
        sqlx::query("DELETE FROM histograms WHERE run_id = ?")
            .bind(run_id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    async fn delete_run(&self, run_id: &str) -> StorageResult<()> {
        // Delete related data first
        sqlx::query("DELETE FROM metrics WHERE run_id = ?")
            .bind(run_id)
            .execute(&self.pool)
            .await?;
        sqlx::query("DELETE FROM histograms WHERE run_id = ?")
            .bind(run_id)
            .execute(&self.pool)
            .await?;
        sqlx::query("DELETE FROM texts WHERE run_id = ?")
            .bind(run_id)
            .execute(&self.pool)
            .await?;
        sqlx::query("DELETE FROM figures WHERE run_id = ?")
            .bind(run_id)
            .execute(&self.pool)
            .await?;
        sqlx::query("DELETE FROM tables WHERE run_id = ?")
            .bind(run_id)
            .execute(&self.pool)
            .await?;
        sqlx::query("DELETE FROM media WHERE run_id = ?")
            .bind(run_id)
            .execute(&self.pool)
            .await?;
        sqlx::query("DELETE FROM run_summary WHERE run_id = ?")
            .bind(run_id)
            .execute(&self.pool)
            .await?;
        sqlx::query("DELETE FROM runs WHERE run_id = ?")
            .bind(run_id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    async fn delete_runs_by_project(&self, project: &str) -> StorageResult<usize> {
        let runs = self
            .list_runs(&RunFilter {
                project: Some(project.into()),
                ..Default::default()
            })
            .await?;
        let running = runs.iter().filter(|r| r.state == "running").count();
        if running > 0 {
            return Err(StorageError::InvalidOperation(format!(
                "project has {} running run(s)",
                running
            )));
        }
        let ids: Vec<String> = runs.into_iter().map(|r| r.run_id).collect();
        let count = ids.len();
        for id in &ids {
            self.delete_run(id).await?;
        }
        sqlx::query("DELETE FROM reports WHERE project = ?")
            .bind(project)
            .execute(&self.pool)
            .await?;
        Ok(count)
    }

    async fn upsert_run(&self, run: &RunMeta) -> StorageResult<()> {
        let mut tx = self.pool.begin().await?;
        sqlx::query(
            "INSERT INTO runs (run_id, project, group_name, name, state, config, env,
                               git_commit, sweep_id, created_at, heartbeat_at, tags, owner_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(run_id) DO UPDATE SET
                 state = excluded.state,
                 heartbeat_at = excluded.heartbeat_at",
        )
        .bind(&run.run_id)
        .bind(&run.project)
        .bind(&run.group_name)
        .bind(&run.name)
        .bind(&run.state)
        .bind(serde_json::to_string(&run.config).unwrap_or_default())
        .bind(serde_json::to_string(&run.env).unwrap_or_default())
        .bind(&run.git_commit)
        .bind(&run.sweep_id)
        .bind(run.created_at)
        .bind(run.heartbeat_at)
        .bind(serde_json::to_string(&run.tags).unwrap_or_default())
        .bind(run.owner_id)
        .execute(&mut *tx)
        .await?;

        tx.commit().await?;
        Ok(())
    }

    async fn list_runs(&self, filter: &RunFilter) -> StorageResult<Vec<RunMeta>> {
        let rows = sqlx::query(
            "SELECT run_id, project, group_name, name, state, config, env,
                    git_commit, sweep_id, created_at, heartbeat_at, tags, owner_id
             FROM runs
             WHERE (?1 IS NULL OR project = ?1)
               AND (?2 IS NULL OR state = ?2)
               AND (?3 IS NULL OR runs.owner_id = ?3)
               AND (?4 IS NULL OR sweep_id = ?4)
             ORDER BY created_at DESC
             LIMIT ?5 OFFSET ?6",
        )
        .bind(&filter.project)
        .bind(&filter.state)
        .bind(filter.owner_id)
        .bind(&filter.sweep_id)
        .bind(filter.limit.unwrap_or(100))
        .bind(filter.offset.unwrap_or(0))
        .fetch_all(&self.pool)
        .await?;

        Ok(rows
            .iter()
            .map(|r| RunMeta {
                run_id: r.get("run_id"),
                project: r.get("project"),
                group_name: r.get("group_name"),
                name: r.get("name"),
                state: r.get("state"),
                config: serde_json::from_str(r.get::<&str, _>("config")).unwrap_or_default(),
                env: serde_json::from_str(r.get::<&str, _>("env")).unwrap_or_default(),
                git_commit: r.get("git_commit"),
                sweep_id: r.get("sweep_id"),
                created_at: r.get("created_at"),
                heartbeat_at: r.get("heartbeat_at"),
                tags: r
                    .get::<Option<&str>, _>("tags")
                    .and_then(|s| serde_json::from_str(s).ok()),
                owner_id: r.get::<Option<i64>, _>("owner_id"),
            })
            .collect())
    }

    async fn count_runs(&self, filter: &RunFilter) -> StorageResult<u64> {
        let row = sqlx::query(
            "SELECT COUNT(*) FROM runs
             WHERE (?1 IS NULL OR project = ?1)
               AND (?2 IS NULL OR state = ?2)
               AND (?3 IS NULL OR runs.owner_id = ?3)
               AND (?4 IS NULL OR sweep_id = ?4)",
        )
        .bind(&filter.project)
        .bind(&filter.state)
        .bind(filter.owner_id)
        .bind(&filter.sweep_id)
        .fetch_one(&self.pool)
        .await?;
        Ok(row.get::<i64, _>("COUNT(*)") as u64)
    }

    async fn get_run(&self, run_id: &str) -> StorageResult<Option<RunMeta>> {
        let row = sqlx::query(
            "SELECT run_id, project, group_name, name, state, config, env,
                    git_commit, sweep_id, created_at, heartbeat_at, tags, owner_id
             FROM runs WHERE run_id = ?",
        )
        .bind(run_id)
        .fetch_optional(&self.pool)
        .await?;
        Ok(row.map(|r| RunMeta {
            run_id: r.get("run_id"),
            project: r.get("project"),
            group_name: r.get("group_name"),
            name: r.get("name"),
            state: r.get("state"),
            config: serde_json::from_str(r.get::<&str, _>("config")).unwrap_or_default(),
            env: serde_json::from_str(r.get::<&str, _>("env")).unwrap_or_default(),
            git_commit: r.get("git_commit"),
            sweep_id: r.get("sweep_id"),
            created_at: r.get("created_at"),
            heartbeat_at: r.get("heartbeat_at"),
            tags: r
                .get::<Option<&str>, _>("tags")
                .and_then(|s| serde_json::from_str(s).ok()),
            owner_id: r.get::<Option<i64>, _>("owner_id"),
        }))
    }

    async fn heartbeat(&self, run_id: &str, ts: f64) -> StorageResult<()> {
        let n = sqlx::query("UPDATE runs SET heartbeat_at = ? WHERE run_id = ?")
            .bind(ts)
            .bind(run_id)
            .execute(&self.pool)
            .await?
            .rows_affected();

        if n == 0 {
            return Err(StorageError::NotFound(run_id.into()));
        }
        Ok(())
    }

    async fn upsert_summary(&self, summaries: &[SummaryRow]) -> StorageResult<()> {
        for s in summaries {
            sqlx::query(
                "INSERT INTO run_summary (run_id, key, context, last, best, best_step,
                                           min_val, max_val, user_val)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                 ON CONFLICT(run_id, key, context) DO UPDATE SET
                     last = COALESCE(excluded.last, run_summary.last),
                     best = COALESCE(excluded.best, run_summary.best),
                     best_step = COALESCE(excluded.best_step, run_summary.best_step),
                     min_val = COALESCE(excluded.min_val, run_summary.min_val),
                     max_val = COALESCE(excluded.max_val, run_summary.max_val),
                     user_val = COALESCE(excluded.user_val, run_summary.user_val)",
            )
            .bind(&s.run_id)
            .bind(&s.key)
            .bind(&s.context)
            .bind(s.last)
            .bind(s.best)
            .bind(s.best_step)
            .bind(s.min_val)
            .bind(s.max_val)
            .bind(s.user_val)
            .execute(&self.pool)
            .await?;
        }
        Ok(())
    }

    async fn get_summary(&self, run_ids: &[String]) -> StorageResult<Vec<SummaryRow>> {
        if run_ids.is_empty() {
            return Ok(vec![]);
        }
        let placeholders = run_ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
        let query = format!(
            "SELECT run_id, key, context, last, best, best_step, min_val, max_val, user_val
             FROM run_summary WHERE run_id IN ({})",
            placeholders
        );
        let mut q = sqlx::query_as::<
            _,
            (
                String,
                String,
                String,
                Option<f64>,
                Option<f64>,
                Option<i64>,
                Option<f64>,
                Option<f64>,
                Option<f64>,
            ),
        >(&query);
        for id in run_ids {
            q = q.bind(id);
        }
        let rows = q.fetch_all(&self.pool).await?;
        Ok(rows
            .iter()
            .map(
                |(run_id, key, context, last, best, best_step, min_val, max_val, user_val)| {
                    SummaryRow {
                        run_id: run_id.clone(),
                        key: key.clone(),
                        context: context.clone(),
                        last: *last,
                        best: *best,
                        best_step: *best_step,
                        min_val: *min_val,
                        max_val: *max_val,
                        user_val: *user_val,
                    }
                },
            )
            .collect())
    }

    async fn insert_texts(&self, texts: &[TextRow]) -> StorageResult<()> {
        for t in texts {
            sqlx::query(
                "INSERT OR REPLACE INTO texts (run_id, step, name, body) VALUES (?, ?, ?, ?)",
            )
            .bind(&t.run_id)
            .bind(t.step)
            .bind(&t.name)
            .bind(&t.body)
            .execute(&self.pool)
            .await?;
        }
        Ok(())
    }

    async fn query_texts(
        &self,
        run_id: &str,
        name: &str,
        after_step: Option<i64>,
    ) -> StorageResult<Vec<TextRow>> {
        let rows = if name.is_empty() {
            sqlx::query(
                "SELECT run_id, step, name, body FROM texts
                 WHERE run_id = ?1 AND (?2 IS NULL OR step > ?2)
                 ORDER BY step",
            )
            .bind(run_id)
            .bind(after_step)
            .bind(after_step)
            .fetch_all(&self.pool)
            .await?
        } else {
            sqlx::query(
                "SELECT run_id, step, name, body FROM texts
                 WHERE run_id = ?1 AND name = ?2 AND (?3 IS NULL OR step > ?3)
                 ORDER BY step",
            )
            .bind(run_id)
            .bind(name)
            .bind(after_step)
            .bind(after_step)
            .fetch_all(&self.pool)
            .await?
        };
        Ok(rows
            .iter()
            .map(|r| TextRow {
                run_id: r.get(0),
                step: r.get(1),
                name: r.get(2),
                body: r.get(3),
            })
            .collect())
    }

    async fn insert_figure(&self, fig: &FigureRow) -> StorageResult<()> {
        sqlx::query("INSERT INTO figures (run_id, step, name, kind, body) VALUES (?, ?, ?, ?, ?)")
            .bind(&fig.run_id)
            .bind(fig.step)
            .bind(&fig.name)
            .bind(&fig.kind)
            .bind(&fig.body)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    async fn query_figures(
        &self,
        run_id: &str,
        name: Option<&str>,
    ) -> StorageResult<Vec<FigureRow>> {
        let rows = sqlx::query(
            "SELECT run_id, step, name, kind, body FROM figures
             WHERE run_id = ?1 AND (?2 IS NULL OR name = ?2)
             ORDER BY step",
        )
        .bind(run_id)
        .bind(name)
        .bind(name)
        .fetch_all(&self.pool)
        .await?;
        Ok(rows
            .iter()
            .map(|r| FigureRow {
                run_id: r.get(0),
                step: r.get(1),
                name: r.get(2),
                kind: r.get(3),
                body: r.get(4),
            })
            .collect())
    }

    async fn insert_user(&self, u: &UserRow) -> StorageResult<i64> {
        let r = sqlx::query(
            "INSERT INTO trailer_users (username, password, role, created_at, theme) VALUES (?, ?, ?, ?, ?)"
        )
        .bind(&u.username).bind(&u.password).bind(&u.role).bind(u.created_at).bind(&u.theme)
        .execute(&self.pool).await?;
        Ok(r.last_insert_rowid())
    }

    async fn get_user_by_username(&self, username: &str) -> StorageResult<Option<UserRow>> {
        let rows = sqlx::query("SELECT id, username, password, role, created_at, theme FROM trailer_users WHERE username = ?")
            .bind(username).fetch_all(&self.pool).await?;
        Ok(rows
            .iter()
            .map(|r| UserRow {
                id: Some(r.get("id")),
                username: r.get("username"),
                password: r.get("password"),
                role: r.get("role"),
                created_at: r.get("created_at"),
                theme: r.get("theme"),
            })
            .next())
    }

    async fn get_user_by_id(&self, id: i64) -> StorageResult<Option<UserRow>> {
        let rows = sqlx::query("SELECT id, username, password, role, created_at, theme FROM trailer_users WHERE id = ?")
            .bind(id).fetch_all(&self.pool).await?;
        Ok(rows
            .iter()
            .map(|r| UserRow {
                id: Some(r.get("id")),
                username: r.get("username"),
                password: r.get("password"),
                role: r.get("role"),
                created_at: r.get("created_at"),
                theme: r.get("theme"),
            })
            .next())
    }

    async fn list_users(
        &self,
        limit: Option<i64>,
        offset: Option<i64>,
    ) -> StorageResult<Vec<UserRow>> {
        let rows = sqlx::query(
            "SELECT id, username, password, role, created_at, theme FROM trailer_users ORDER BY id LIMIT ? OFFSET ?"
        )
        .bind(limit.unwrap_or(100)).bind(offset.unwrap_or(0))
        .fetch_all(&self.pool).await?;
        Ok(rows
            .iter()
            .map(|r| UserRow {
                id: Some(r.get("id")),
                username: r.get("username"),
                password: r.get("password"),
                role: r.get("role"),
                created_at: r.get("created_at"),
                theme: r.get("theme"),
            })
            .collect())
    }

    async fn count_users(&self) -> StorageResult<u64> {
        let row = sqlx::query("SELECT COUNT(*) FROM trailer_users")
            .fetch_one(&self.pool)
            .await?;
        Ok(row.get::<i64, _>("COUNT(*)") as u64)
    }

    async fn get_user_theme(&self, user_id: i64) -> StorageResult<String> {
        let rows = sqlx::query("SELECT theme FROM trailer_users WHERE id = ?")
            .bind(user_id)
            .fetch_all(&self.pool)
            .await?;
        Ok(rows
            .first()
            .map(|r| r.get::<String, _>("theme"))
            .unwrap_or_else(|| "{}".into()))
    }

    async fn update_user_theme(&self, user_id: i64, theme_json: &str) -> StorageResult<()> {
        sqlx::query("UPDATE trailer_users SET theme = ? WHERE id = ?")
            .bind(theme_json)
            .bind(user_id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    async fn update_user_role(&self, id: i64, role: &str) -> StorageResult<()> {
        sqlx::query("UPDATE trailer_users SET role = ? WHERE id = ?")
            .bind(role)
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    async fn update_user_password(&self, id: i64, password: &str) -> StorageResult<()> {
        sqlx::query("UPDATE trailer_users SET password = ? WHERE id = ?")
            .bind(password)
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    async fn delete_user(&self, id: i64) -> StorageResult<()> {
        sqlx::query("DELETE FROM trailer_users WHERE id = ?")
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    async fn insert_report(&self, r: &ReportRow) -> StorageResult<String> {
        let id = format!("report_{:x}", rand::random::<u64>());
        sqlx::query(
            "INSERT INTO reports (id, owner_id, project, title, body, created_at) VALUES (?, ?, ?, ?, ?, ?)"
        )
        .bind(&id).bind(r.owner_id).bind(&r.project).bind(&r.title).bind(&r.body).bind(r.created_at)
        .execute(&self.pool).await?;
        Ok(id)
    }

    async fn update_report(&self, id: &str, title: &str, body: &str) -> StorageResult<()> {
        sqlx::query("UPDATE reports SET title = ?, body = ? WHERE id = ?")
            .bind(title)
            .bind(body)
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    async fn delete_report(&self, id: &str) -> StorageResult<()> {
        sqlx::query("DELETE FROM reports WHERE id = ?")
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    async fn list_reports(
        &self,
        project: Option<&str>,
        owner_id: Option<i64>,
        limit: Option<i64>,
        offset: Option<i64>,
    ) -> StorageResult<Vec<ReportRow>> {
        let rows = sqlx::query(
            "SELECT id, owner_id, project, title, body, created_at FROM reports
             WHERE (?1 IS NULL OR project = ?1)
               AND (?2 IS NULL OR owner_id = ?2)
             ORDER BY created_at DESC LIMIT ?3 OFFSET ?4",
        )
        .bind(project)
        .bind(owner_id)
        .bind(limit.unwrap_or(100))
        .bind(offset.unwrap_or(0))
        .fetch_all(&self.pool)
        .await?;
        Ok(rows
            .iter()
            .map(|r| ReportRow {
                id: Some(r.get("id")),
                owner_id: r.get("owner_id"),
                project: r.get("project"),
                title: r.get("title"),
                body: r.get("body"),
                created_at: r.get("created_at"),
            })
            .collect())
    }

    async fn count_reports(&self, project: Option<&str>, owner_id: Option<i64>) -> StorageResult<u64> {
        let row = sqlx::query(
            "SELECT COUNT(*) FROM reports WHERE (?1 IS NULL OR project = ?1) AND (?2 IS NULL OR owner_id = ?2)",
        )
        .bind(project)
        .bind(owner_id)
        .fetch_one(&self.pool)
        .await?;
        Ok(row.get::<i64, _>("COUNT(*)") as u64)
    }

    async fn get_report(&self, id: &str) -> StorageResult<Option<ReportRow>> {
        let rows = sqlx::query(
            "SELECT id, owner_id, project, title, body, created_at FROM reports WHERE id = ?",
        )
        .bind(id)
        .fetch_all(&self.pool)
        .await?;
        Ok(rows
            .iter()
            .map(|r| ReportRow {
                id: Some(r.get("id")),
                owner_id: r.get("owner_id"),
                project: r.get("project"),
                title: r.get("title"),
                body: r.get("body"),
                created_at: r.get("created_at"),
            })
            .next())
    }

    // ── Explores ──
    async fn insert_explore(&self, e: &ExploreRow) -> StorageResult<String> {
        let id = format!("explore_{:x}", rand::random::<u64>());
        sqlx::query(
            "INSERT INTO explores (id, owner_id, project, title, description, run_ids, chart_defs, config, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
        )
        .bind(&id).bind(e.owner_id).bind(&e.project).bind(&e.title).bind(&e.description)
        .bind(&e.run_ids).bind(&e.chart_defs).bind(&e.config)
        .bind(e.created_at).bind(e.updated_at)
        .execute(&self.pool).await?;
        Ok(id)
    }

    async fn update_explore(
        &self,
        id: &str,
        title: &str,
        description: &str,
        run_ids: &str,
        chart_defs: &str,
        config: &str,
    ) -> StorageResult<()> {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs_f64();
        sqlx::query(
            "UPDATE explores SET title = ?, description = ?, run_ids = ?, chart_defs = ?, config = ?, updated_at = ? WHERE id = ?"
        )
        .bind(title).bind(description).bind(run_ids).bind(chart_defs).bind(config).bind(now).bind(id)
        .execute(&self.pool).await?;
        Ok(())
    }

    async fn delete_explore(&self, id: &str) -> StorageResult<()> {
        sqlx::query("DELETE FROM explores WHERE id = ?")
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    async fn list_explores(
        &self,
        owner_id: i64,
        project: Option<&str>,
        limit: Option<i64>,
        offset: Option<i64>,
    ) -> StorageResult<Vec<ExploreRow>> {
        // owner_id = 0 表示不过滤(admin 看全部)
        let rows = sqlx::query(
            "SELECT id, owner_id, project, title, description, run_ids, chart_defs, config, created_at, updated_at
             FROM explores
             WHERE (?1 = 0 OR owner_id = ?1)
               AND (?2 IS NULL OR project = ?2)
             ORDER BY updated_at DESC LIMIT ?3 OFFSET ?4"
        )
        .bind(owner_id).bind(project).bind(limit.unwrap_or(100)).bind(offset.unwrap_or(0))
        .fetch_all(&self.pool).await?;
        Ok(rows
            .iter()
            .map(|r| ExploreRow {
                id: Some(r.get("id")),
                owner_id: r.get("owner_id"),
                project: r.get("project"),
                title: r.get("title"),
                description: r.get("description"),
                run_ids: r.get("run_ids"),
                chart_defs: r.get("chart_defs"),
                config: r.get("config"),
                created_at: r.get("created_at"),
                updated_at: r.get("updated_at"),
            })
            .collect())
    }

    async fn count_explores(&self, owner_id: i64, project: Option<&str>) -> StorageResult<u64> {
        let row = sqlx::query(
            "SELECT COUNT(*) FROM explores WHERE (?1 = 0 OR owner_id = ?1) AND (?2 IS NULL OR project = ?2)"
        )
        .bind(owner_id).bind(project).fetch_one(&self.pool).await?;
        Ok(row.get::<i64, _>("COUNT(*)") as u64)
    }

    async fn get_explore(&self, id: &str) -> StorageResult<Option<ExploreRow>> {
        let rows = sqlx::query(
            "SELECT id, owner_id, project, title, description, run_ids, chart_defs, config, created_at, updated_at
             FROM explores WHERE id = ?"
        )
        .bind(id).fetch_all(&self.pool).await?;
        Ok(rows
            .iter()
            .map(|r| ExploreRow {
                id: Some(r.get("id")),
                owner_id: r.get("owner_id"),
                project: r.get("project"),
                title: r.get("title"),
                description: r.get("description"),
                run_ids: r.get("run_ids"),
                chart_defs: r.get("chart_defs"),
                config: r.get("config"),
                created_at: r.get("created_at"),
                updated_at: r.get("updated_at"),
            })
            .next())
    }

    async fn insert_table(&self, t: &TableRow) -> StorageResult<i64> {
        let columns = serde_json::to_string(&t.columns).unwrap_or_default();
        let data = t.data.to_string();
        let result = sqlx::query(
            "INSERT INTO tables (run_id, step, name, columns, data, row_count, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&t.run_id)
        .bind(t.step)
        .bind(&t.name)
        .bind(&columns)
        .bind(&data)
        .bind(t.row_count)
        .bind(t.created_at)
        .execute(&self.pool)
        .await?;
        Ok(result.last_insert_rowid())
    }

    async fn query_tables(&self, run_id: &str, name: Option<&str>) -> StorageResult<Vec<TableRow>> {
        let rows = sqlx::query(
            "SELECT id, run_id, step, name, columns, data, row_count, created_at FROM tables
             WHERE run_id = ?1 AND (?2 IS NULL OR name = ?2)
             ORDER BY step",
        )
        .bind(run_id)
        .bind(name)
        .bind(name)
        .fetch_all(&self.pool)
        .await?;
        Ok(rows
            .iter()
            .map(|r| TableRow {
                id: Some(r.get("id")),
                run_id: r.get("run_id"),
                step: r.get("step"),
                name: r.get("name"),
                columns: serde_json::from_str(r.get::<&str, _>("columns")).unwrap_or_default(),
                data: serde_json::from_str(r.get::<&str, _>("data"))
                    .unwrap_or(serde_json::Value::Null),
                row_count: r.get("row_count"),
                created_at: r.get("created_at"),
            })
            .collect())
    }

    async fn get_table_by_id(&self, id: i64) -> StorageResult<Option<TableRow>> {
        let rows = sqlx::query(
            "SELECT id, run_id, step, name, columns, data, row_count, created_at FROM tables WHERE id = ?"
        ).bind(id).fetch_all(&self.pool).await?;
        Ok(rows
            .iter()
            .map(|r| TableRow {
                id: Some(r.get("id")),
                run_id: r.get("run_id"),
                step: r.get("step"),
                name: r.get("name"),
                columns: serde_json::from_str(r.get::<&str, _>("columns")).unwrap_or_default(),
                data: serde_json::from_str(r.get::<&str, _>("data"))
                    .unwrap_or(serde_json::Value::Null),
                row_count: r.get("row_count"),
                created_at: r.get("created_at"),
            })
            .next())
    }

    async fn insert_media(&self, m: &MediaRow) -> StorageResult<i64> {
        let result = sqlx::query(
            "INSERT INTO media (run_id, step, name, kind, ext, hash, file_path, size, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&m.run_id)
        .bind(m.step)
        .bind(&m.name)
        .bind(&m.kind)
        .bind(&m.ext)
        .bind(&m.hash)
        .bind(&m.file_path)
        .bind(m.size)
        .bind(m.created_at)
        .execute(&self.pool)
        .await?;
        Ok(result.last_insert_rowid())
    }

    async fn query_media(&self, run_id: &str, kind: Option<&str>) -> StorageResult<Vec<MediaRow>> {
        let rows = sqlx::query(
            "SELECT id, run_id, step, name, kind, ext, hash, file_path, size, created_at
             FROM media
             WHERE run_id = ?1 AND (?2 IS NULL OR kind = ?2)
             ORDER BY step",
        )
        .bind(run_id)
        .bind(kind)
        .bind(kind)
        .fetch_all(&self.pool)
        .await?;
        Ok(rows
            .iter()
            .map(|r| MediaRow {
                id: Some(r.get("id")),
                run_id: r.get("run_id"),
                step: r.get("step"),
                name: r.get("name"),
                kind: r.get("kind"),
                ext: r.get("ext"),
                hash: r.get("hash"),
                file_path: r.get("file_path"),
                size: r.get("size"),
                created_at: r.get("created_at"),
            })
            .collect())
    }

    async fn get_media_by_id(&self, id: i64) -> StorageResult<Option<MediaRow>> {
        let rows = sqlx::query(
            "SELECT id, run_id, step, name, kind, ext, hash, file_path, size, created_at
             FROM media WHERE id = ?",
        )
        .bind(id)
        .fetch_all(&self.pool)
        .await?;
        Ok(rows
            .iter()
            .map(|r| MediaRow {
                id: Some(r.get("id")),
                run_id: r.get("run_id"),
                step: r.get("step"),
                name: r.get("name"),
                kind: r.get("kind"),
                ext: r.get("ext"),
                hash: r.get("hash"),
                file_path: r.get("file_path"),
                size: r.get("size"),
                created_at: r.get("created_at"),
            })
            .next())
    }

    async fn insert_artifact(&self, _meta: &ArtifactMeta) -> StorageResult<()> {
        // Stub — full implementation in M1
        Ok(())
    }

    async fn create_share(
        &self,
        token: &str,
        resource_type: &str,
        resource_id: &str,
        expires_at: Option<f64>,
    ) -> StorageResult<()> {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs_f64();
        sqlx::query("INSERT INTO shares (token, resource_type, resource_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?)")
            .bind(token).bind(resource_type).bind(resource_id).bind(now).bind(expires_at)
            .execute(&self.pool).await?;
        Ok(())
    }

    async fn get_share(&self, token: &str) -> StorageResult<Option<(String, String, Option<f64>)>> {
        let row = sqlx::query_as::<_, (String, String, Option<f64>)>(
            "SELECT resource_type, resource_id, expires_at FROM shares WHERE token = ?",
        )
        .bind(token)
        .fetch_optional(&self.pool)
        .await?;
        Ok(row)
    }

    async fn list_shares(
        &self,
        limit: Option<i64>,
        offset: Option<i64>,
    ) -> StorageResult<Vec<ShareInfo>> {
        let rows = sqlx::query(
            "SELECT token, resource_type, resource_id, created_at, expires_at FROM shares ORDER BY created_at DESC LIMIT ?1 OFFSET ?2"
        )
        .bind(limit.unwrap_or(100)).bind(offset.unwrap_or(0))
        .fetch_all(&self.pool).await?;
        Ok(rows
            .iter()
            .map(|r| ShareInfo {
                token: r.get("token"),
                resource_type: r.get("resource_type"),
                resource_id: r.get("resource_id"),
                created_at: r.get("created_at"),
                expires_at: r.get("expires_at"),
            })
            .collect())
    }

    async fn count_shares(&self) -> StorageResult<u64> {
        let row = sqlx::query("SELECT COUNT(*) FROM shares")
            .fetch_one(&self.pool)
            .await?;
        Ok(row.get::<i64, _>("COUNT(*)") as u64)
    }

    async fn delete_share(&self, token: &str) -> StorageResult<()> {
        sqlx::query("DELETE FROM shares WHERE token = ?")
            .bind(token)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    async fn update_share_expiry(&self, token: &str, expires_at: Option<f64>) -> StorageResult<()> {
        sqlx::query("UPDATE shares SET expires_at = ? WHERE token = ?")
            .bind(expires_at)
            .bind(token)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    async fn delete_expired_shares(&self) -> StorageResult<usize> {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs_f64();
        let result =
            sqlx::query("DELETE FROM shares WHERE expires_at IS NOT NULL AND expires_at < ?")
                .bind(now)
                .execute(&self.pool)
                .await?;
        Ok(result.rows_affected() as usize)
    }

    // ── API Tokens ──

    async fn create_api_token(
        &self,
        token: &str,
        user_id: i64,
        name: Option<&str>,
        expires_at: Option<f64>,
    ) -> StorageResult<()> {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs_f64();
        sqlx::query("INSERT INTO api_tokens (token, user_id, name, created_at, expires_at) VALUES (?, ?, ?, ?, ?)")
            .bind(token).bind(user_id).bind(name).bind(now).bind(expires_at)
            .execute(&self.pool).await?;
        Ok(())
    }

    async fn list_api_tokens(&self, user_id: i64) -> StorageResult<Vec<ApiToken>> {
        let rows = sqlx::query(
            "SELECT token, user_id, name, created_at, expires_at FROM api_tokens WHERE user_id = ? ORDER BY created_at DESC"
        ).bind(user_id).fetch_all(&self.pool).await?;
        Ok(rows
            .iter()
            .map(|r| ApiToken {
                token: r.get("token"),
                user_id: r.get("user_id"),
                name: r.get("name"),
                created_at: r.get("created_at"),
                expires_at: r.get("expires_at"),
            })
            .collect())
    }

    async fn delete_api_token(&self, token: &str) -> StorageResult<()> {
        sqlx::query("DELETE FROM api_tokens WHERE token = ?")
            .bind(token)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    async fn delete_api_tokens_by_name(&self, name: &str) -> StorageResult<usize> {
        let res = sqlx::query("DELETE FROM api_tokens WHERE name = ?")
            .bind(name)
            .execute(&self.pool)
            .await?;
        Ok(res.rows_affected() as usize)
    }

    async fn update_api_token_expiry(
        &self,
        token: &str,
        expires_at: Option<f64>,
    ) -> StorageResult<()> {
        sqlx::query("UPDATE api_tokens SET expires_at = ? WHERE token = ?")
            .bind(expires_at)
            .bind(token)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    async fn get_user_by_api_token(&self, token: &str) -> StorageResult<Option<UserRow>> {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs_f64();
        let row = sqlx::query_as::<_, (i64, String, String, String, f64)>(
            "SELECT u.id, u.username, u.password, u.role, u.created_at
             FROM api_tokens t JOIN trailer_users u ON u.id = t.user_id
             WHERE t.token = ? AND (t.expires_at IS NULL OR t.expires_at > ?)",
        )
        .bind(token)
        .bind(now)
        .fetch_optional(&self.pool)
        .await?;
        Ok(
            row.map(|(id, username, password, role, created_at)| UserRow {
                id: Some(id),
                username,
                password,
                role,
                created_at,
                theme: "{}".into(),
            }),
        )
    }

    // ── Project Ownership ──

    /// 项目 owner = 该项目下第一个 run 的 owner_id(由 runs 表推导)。
    async fn get_project_owner(&self, project: &str) -> StorageResult<Option<i64>> {
        let row = sqlx::query_as::<_, (i64,)>(
            "SELECT owner_id FROM runs WHERE project = ? AND owner_id IS NOT NULL ORDER BY created_at LIMIT 1"
        ).bind(project).fetch_optional(&self.pool).await?;
        Ok(row.map(|r| r.0))
    }
}

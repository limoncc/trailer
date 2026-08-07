use async_trait::async_trait;
use sqlx::postgres::{PgPool, PgPoolOptions};
use sqlx::Row;

use crate::domain::{
    ApiToken, ArtifactMeta, ExploreRow, FigureRow, HistogramRow, MediaRow, MetricQuery, MetricRow,
    ReportRow, RunFilter, RunMeta, ShareInfo, SummaryRow, TableRow, TextRow, UserRow,
};
use crate::error::{StorageError, StorageResult};
use crate::storage::Storage;

pub struct PgStorage {
    pool: PgPool,
}

impl PgStorage {
    pub async fn open(url: &str) -> StorageResult<Self> {
        let pool = PgPoolOptions::new()
            .max_connections(10)
            .connect(url)
            .await?;
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
                config       JSONB NOT NULL DEFAULT '{}',
                env          JSONB NOT NULL DEFAULT '{}',
                git_commit   TEXT,
                sweep_id     TEXT,
                created_at   DOUBLE PRECISION NOT NULL,
                heartbeat_at DOUBLE PRECISION,
                tags         JSONB DEFAULT '[]',
                owner_id     BIGINT
            )",
        )
        .execute(&self.pool)
        .await?;

        sqlx::query(
            "CREATE TABLE IF NOT EXISTS metrics (
                run_id    TEXT NOT NULL,
                step      BIGINT NOT NULL,
                wall_time DOUBLE PRECISION NOT NULL,
                key       TEXT NOT NULL,
                context   TEXT NOT NULL DEFAULT '',
                value     DOUBLE PRECISION NOT NULL
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
                wall_time     DOUBLE PRECISION NOT NULL,
                key           TEXT NOT NULL,
                context       TEXT NOT NULL DEFAULT '',
                bucket_limits JSONB NOT NULL DEFAULT '[]',
                bucket_counts JSONB NOT NULL DEFAULT '[]',
                min           DOUBLE PRECISION NOT NULL,
                max           DOUBLE PRECISION NOT NULL,
                num           BIGINT NOT NULL,
                sum           DOUBLE PRECISION NOT NULL,
                sum_squares   DOUBLE PRECISION NOT NULL
            )",
        )
        .execute(&self.pool)
        .await?;

        sqlx::query(
            "CREATE INDEX IF NOT EXISTS idx_histograms_run_key ON histograms(run_id, key, context, step)"
        ).execute(&self.pool).await?;

        sqlx::query(
            "CREATE TABLE IF NOT EXISTS run_summary (
                run_id     TEXT NOT NULL,
                key        TEXT NOT NULL,
                context    TEXT NOT NULL DEFAULT '',
                last       DOUBLE PRECISION,
                best       DOUBLE PRECISION,
                best_step  BIGINT,
                min_val    DOUBLE PRECISION,
                max_val    DOUBLE PRECISION,
                user_val   DOUBLE PRECISION,
                PRIMARY KEY (run_id, key, context)
            )",
        )
        .execute(&self.pool)
        .await?;

        sqlx::query(
            "CREATE TABLE IF NOT EXISTS artifacts (
                id         BIGSERIAL PRIMARY KEY,
                run_id     TEXT NOT NULL,
                step       BIGINT,
                name       TEXT NOT NULL,
                kind       TEXT NOT NULL,
                hash       TEXT NOT NULL,
                rel_path   TEXT NOT NULL,
                size       BIGINT,
                created_at DOUBLE PRECISION,
                CONSTRAINT uq_artifact UNIQUE (run_id, name, step, hash)
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
            "CREATE TABLE IF NOT EXISTS trailer_users (
                id         BIGSERIAL PRIMARY KEY,
                username   TEXT UNIQUE NOT NULL,
                password   TEXT NOT NULL,
                role       TEXT NOT NULL DEFAULT 'experimenter',
                created_at DOUBLE PRECISION NOT NULL,
                theme      TEXT NOT NULL DEFAULT '{}'
            )",
        )
        .execute(&self.pool)
        .await?;
        // 兼容旧库:补 theme 列(若已存在则忽略)
        let _ = sqlx::query(
            "ALTER TABLE trailer_users ADD COLUMN IF NOT EXISTS theme TEXT NOT NULL DEFAULT '{}'",
        )
        .execute(&self.pool)
        .await;

        sqlx::query(
            "CREATE TABLE IF NOT EXISTS figures (
                run_id TEXT NOT NULL, step BIGINT NOT NULL,
                name TEXT NOT NULL, kind TEXT NOT NULL,
                body TEXT NOT NULL
            )",
        )
        .execute(&self.pool)
        .await?;

        // 迁移:旧版 reports 表 id 为 integer/bigint,重建为 TEXT(旧数据删除)
        {
            let old: i64 = sqlx::query(
                "SELECT COUNT(*) FROM information_schema.columns WHERE table_name='reports' AND column_name='id' AND data_type IN ('integer','bigint')"
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
                owner_id   BIGINT,
                project    TEXT NOT NULL,
                title      TEXT NOT NULL,
                body       TEXT NOT NULL,
                created_at DOUBLE PRECISION NOT NULL
            )",
        )
        .execute(&self.pool)
        .await?;

        // 迁移:旧版 explores 表 id 为 integer/bigint,重建为 TEXT(旧数据删除)
        {
            let old: i64 = sqlx::query(
                "SELECT COUNT(*) FROM information_schema.columns WHERE table_name='explores' AND column_name='id' AND data_type IN ('integer','bigint')"
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
                owner_id    BIGINT NOT NULL,
                project     TEXT NOT NULL DEFAULT '',
                title       TEXT NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                run_ids     TEXT NOT NULL,
                chart_defs  TEXT NOT NULL,
                config      TEXT NOT NULL DEFAULT '{}',
                created_at  DOUBLE PRECISION NOT NULL,
                updated_at  DOUBLE PRECISION NOT NULL
            )",
        )
        .execute(&self.pool)
        .await?;

        sqlx::query(
            "CREATE TABLE IF NOT EXISTS tables (
                id         BIGSERIAL PRIMARY KEY,
                run_id     TEXT NOT NULL,
                step       BIGINT NOT NULL,
                name       TEXT NOT NULL,
                columns    TEXT NOT NULL,
                data       TEXT NOT NULL,
                row_count  BIGINT NOT NULL,
                created_at DOUBLE PRECISION NOT NULL
            )",
        )
        .execute(&self.pool)
        .await?;

        sqlx::query(
            "CREATE TABLE IF NOT EXISTS media (
                id         BIGSERIAL PRIMARY KEY,
                run_id     TEXT NOT NULL,
                step       BIGINT NOT NULL,
                name       TEXT NOT NULL,
                kind       TEXT NOT NULL,
                ext        TEXT NOT NULL,
                hash       TEXT NOT NULL,
                file_path  TEXT NOT NULL,
                size       BIGINT NOT NULL,
                created_at DOUBLE PRECISION NOT NULL
            )",
        )
        .execute(&self.pool)
        .await?;

        sqlx::query(
            "CREATE TABLE IF NOT EXISTS shares (
                token         TEXT PRIMARY KEY,
                resource_type TEXT NOT NULL,
                resource_id   TEXT NOT NULL,
                created_at    DOUBLE PRECISION NOT NULL,
                expires_at    DOUBLE PRECISION
            )",
        )
        .execute(&self.pool)
        .await?;

        sqlx::query(
            "CREATE TABLE IF NOT EXISTS api_tokens (
                token      TEXT PRIMARY KEY,
                user_id    BIGINT NOT NULL,
                name       TEXT,
                created_at DOUBLE PRECISION NOT NULL,
                expires_at DOUBLE PRECISION
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
impl Storage for PgStorage {
    async fn insert_metrics(&self, records: &[MetricRow]) -> StorageResult<()> {
        let mut tx = self.pool.begin().await?;
        for rec in records {
            sqlx::query(
                "INSERT INTO metrics (run_id, step, wall_time, key, context, value)
                 VALUES ($1, $2, $3, $4, $5, $6)",
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
                WHERE ($1::text IS NULL OR run_id = $1)
                  AND ($2::text IS NULL OR key = $2)
                  AND ($3::text IS NULL OR context = $3)
                  AND ($4::bigint IS NULL OR step > $4 OR key LIKE 'system/%')
             ) t WHERE total <= $5
                OR rn = total
                OR (rn - 1) % ((total + $5 - 1) / $5) = 0
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
            sqlx::query_as("SELECT COALESCE(MAX(step), 0) FROM metrics WHERE run_id = $1")
                .bind(run_id)
                .fetch_optional(&self.pool)
                .await?;
        Ok(row.map(|r| r.0).filter(|&v| v > 0))
    }

    async fn delete_metrics_for_run(&self, run_id: &str) -> StorageResult<()> {
        sqlx::query("DELETE FROM metrics WHERE run_id = $1")
            .bind(run_id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    async fn insert_histograms(&self, records: &[HistogramRow]) -> StorageResult<()> {
        let mut tx = self.pool.begin().await?;
        for rec in records {
            sqlx::query(
                "INSERT INTO histograms (run_id, step, wall_time, key, context,
                 bucket_limits, bucket_counts, min, max, num, sum, sum_squares)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)",
            )
            .bind(&rec.run_id)
            .bind(rec.step)
            .bind(rec.wall_time)
            .bind(&rec.key)
            .bind(&rec.context)
            .bind(serde_json::to_value(&rec.bucket_limits).unwrap_or_default())
            .bind(serde_json::to_value(&rec.bucket_counts).unwrap_or_default())
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
             WHERE run_id = $1
               AND ($2::text IS NULL OR key = $2)
               AND ($3::text IS NULL OR context = $3)
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
                bucket_limits: serde_json::from_value(
                    r.get::<serde_json::Value, _>("bucket_limits"),
                )
                .unwrap_or_default(),
                bucket_counts: serde_json::from_value(
                    r.get::<serde_json::Value, _>("bucket_counts"),
                )
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
        sqlx::query("DELETE FROM histograms WHERE run_id = $1")
            .bind(run_id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    async fn delete_run(&self, run_id: &str) -> StorageResult<()> {
        sqlx::query("DELETE FROM metrics WHERE run_id = $1")
            .bind(run_id)
            .execute(&self.pool)
            .await?;
        sqlx::query("DELETE FROM histograms WHERE run_id = $1")
            .bind(run_id)
            .execute(&self.pool)
            .await?;
        sqlx::query("DELETE FROM texts WHERE run_id = $1")
            .bind(run_id)
            .execute(&self.pool)
            .await?;
        sqlx::query("DELETE FROM figures WHERE run_id = $1")
            .bind(run_id)
            .execute(&self.pool)
            .await?;
        sqlx::query("DELETE FROM tables WHERE run_id = $1")
            .bind(run_id)
            .execute(&self.pool)
            .await?;
        sqlx::query("DELETE FROM media WHERE run_id = $1")
            .bind(run_id)
            .execute(&self.pool)
            .await?;
        sqlx::query("DELETE FROM run_summary WHERE run_id = $1")
            .bind(run_id)
            .execute(&self.pool)
            .await?;
        sqlx::query("DELETE FROM runs WHERE run_id = $1")
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
        sqlx::query("DELETE FROM reports WHERE project = $1")
            .bind(project)
            .execute(&self.pool)
            .await?;
        Ok(count)
    }

    async fn insert_user(&self, u: &UserRow) -> StorageResult<i64> {
        let row: (i64,) = sqlx::query_as(
            "INSERT INTO trailer_users (username, password, role, created_at, theme) VALUES ($1, $2, $3, $4, $5) RETURNING id"
        )
        .bind(&u.username).bind(&u.password).bind(&u.role).bind(u.created_at).bind(&u.theme)
        .fetch_one(&self.pool).await?;
        Ok(row.0)
    }

    async fn get_user_by_username(&self, username: &str) -> StorageResult<Option<UserRow>> {
        let rows = sqlx::query("SELECT id, username, password, role, created_at, theme FROM trailer_users WHERE username = $1")
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
        let rows = sqlx::query("SELECT id, username, password, role, created_at, theme FROM trailer_users WHERE id = $1")
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
        let rows = sqlx::query("SELECT id, username, password, role, created_at, theme FROM trailer_users ORDER BY id LIMIT $1 OFFSET $2")
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
        Ok(row.get::<i64, _>("count") as u64)
    }

    async fn get_user_theme(&self, user_id: i64) -> StorageResult<String> {
        let rows = sqlx::query("SELECT theme FROM trailer_users WHERE id = $1")
            .bind(user_id)
            .fetch_all(&self.pool)
            .await?;
        Ok(rows
            .first()
            .map(|r| r.get::<String, _>("theme"))
            .unwrap_or_else(|| "{}".into()))
    }

    async fn update_user_theme(&self, user_id: i64, theme_json: &str) -> StorageResult<()> {
        sqlx::query("UPDATE trailer_users SET theme = $1 WHERE id = $2")
            .bind(theme_json)
            .bind(user_id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    async fn update_user_role(&self, id: i64, role: &str) -> StorageResult<()> {
        sqlx::query("UPDATE trailer_users SET role = $1 WHERE id = $2")
            .bind(role)
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    async fn update_user_password(&self, id: i64, password: &str) -> StorageResult<()> {
        sqlx::query("UPDATE trailer_users SET password = $1 WHERE id = $2")
            .bind(password)
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    async fn delete_user(&self, id: i64) -> StorageResult<()> {
        sqlx::query("DELETE FROM trailer_users WHERE id = $1")
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    async fn upsert_run(&self, run: &RunMeta) -> StorageResult<()> {
        let mut tx = self.pool.begin().await?;
        sqlx::query(
            "INSERT INTO runs (run_id, project, group_name, name, state, config, env,
                               git_commit, sweep_id, created_at, heartbeat_at, tags, owner_id)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
             ON CONFLICT(run_id) DO UPDATE SET
                 state = EXCLUDED.state, heartbeat_at = EXCLUDED.heartbeat_at",
        )
        .bind(&run.run_id)
        .bind(&run.project)
        .bind(&run.group_name)
        .bind(&run.name)
        .bind(&run.state)
        .bind(&run.config)
        .bind(&run.env)
        .bind(&run.git_commit)
        .bind(&run.sweep_id)
        .bind(run.created_at)
        .bind(run.heartbeat_at)
        .bind(serde_json::to_value(&run.tags).unwrap_or(serde_json::Value::Null))
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
             WHERE ($1::text IS NULL OR project = $1)
               AND ($2::text IS NULL OR state = $2)
               AND ($3::bigint IS NULL OR runs.owner_id = $3)
               AND ($4::text IS NULL OR sweep_id = $4)
             ORDER BY created_at DESC LIMIT $5 OFFSET $6",
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
            .map(|r| {
                let tags_val: serde_json::Value = r.get("tags");
                let tags: Option<Vec<String>> = serde_json::from_value(tags_val).ok();
                RunMeta {
                    run_id: r.get("run_id"),
                    project: r.get("project"),
                    group_name: r.get("group_name"),
                    name: r.get("name"),
                    state: r.get("state"),
                    config: r.get("config"),
                    env: r.get("env"),
                    git_commit: r.get("git_commit"),
                    sweep_id: r.get("sweep_id"),
                    created_at: r.get("created_at"),
                    heartbeat_at: r.get("heartbeat_at"),
                    tags,
                    owner_id: r.get::<Option<i64>, _>("owner_id"),
                }
            })
            .collect())
    }

    async fn count_runs(&self, filter: &RunFilter) -> StorageResult<u64> {
        let row = sqlx::query(
            "SELECT COUNT(*) FROM runs
             WHERE ($1::text IS NULL OR project = $1)
               AND ($2::text IS NULL OR state = $2)
               AND ($3::bigint IS NULL OR runs.owner_id = $3)
               AND ($4::text IS NULL OR sweep_id = $4)",
        )
        .bind(&filter.project)
        .bind(&filter.state)
        .bind(filter.owner_id)
        .bind(&filter.sweep_id)
        .fetch_one(&self.pool)
        .await?;
        Ok(row.get::<i64, _>("count") as u64)
    }

    async fn get_run(&self, run_id: &str) -> StorageResult<Option<RunMeta>> {
        let row = sqlx::query(
            "SELECT run_id, project, group_name, name, state, config, env,
                    git_commit, sweep_id, created_at, heartbeat_at, tags, owner_id
             FROM runs WHERE run_id = $1",
        )
        .bind(run_id)
        .fetch_optional(&self.pool)
        .await?;
        Ok(row.map(|r| {
            let tags_val: serde_json::Value = r.get("tags");
            let tags: Option<Vec<String>> = serde_json::from_value(tags_val).ok();
            RunMeta {
                run_id: r.get("run_id"),
                project: r.get("project"),
                group_name: r.get("group_name"),
                name: r.get("name"),
                state: r.get("state"),
                config: r.get("config"),
                env: r.get("env"),
                git_commit: r.get("git_commit"),
                sweep_id: r.get("sweep_id"),
                created_at: r.get("created_at"),
                heartbeat_at: r.get("heartbeat_at"),
                tags,
                owner_id: r.get::<Option<i64>, _>("owner_id"),
            }
        }))
    }

    async fn heartbeat(&self, run_id: &str, ts: f64) -> StorageResult<()> {
        let n = sqlx::query("UPDATE runs SET heartbeat_at = $1 WHERE run_id = $2")
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
                "INSERT INTO run_summary (run_id, key, context, last, best, best_step, min_val, max_val, user_val)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                 ON CONFLICT (run_id, key, context) DO UPDATE SET
                    last = EXCLUDED.last,
                    best = EXCLUDED.best,
                    best_step = EXCLUDED.best_step,
                    min_val = EXCLUDED.min_val,
                    max_val = EXCLUDED.max_val,
                    user_val = EXCLUDED.user_val"
            )
            .bind(&s.run_id).bind(&s.key).bind(&s.context)
            .bind(s.last).bind(s.best).bind(s.best_step)
            .bind(s.min_val).bind(s.max_val).bind(s.user_val)
            .execute(&self.pool).await?;
        }
        Ok(())
    }

    async fn get_summary(&self, run_ids: &[String]) -> StorageResult<Vec<SummaryRow>> {
        if run_ids.is_empty() {
            return Ok(vec![]);
        }
        let placeholders: Vec<String> = (1..=run_ids.len()).map(|i| format!("${}", i)).collect();
        let sql = format!(
            "SELECT run_id, key, context, last, best, best_step, min_val, max_val, user_val
             FROM run_summary WHERE run_id IN ({})",
            placeholders.join(",")
        );
        let mut q = sqlx::query(&sql);
        for rid in run_ids {
            q = q.bind(rid);
        }
        let rows = q.fetch_all(&self.pool).await?;
        Ok(rows
            .iter()
            .map(|r| SummaryRow {
                run_id: r.get("run_id"),
                key: r.get("key"),
                context: r.get("context"),
                last: r.get("last"),
                best: r.get("best"),
                best_step: r.get("best_step"),
                min_val: r.get("min_val"),
                max_val: r.get("max_val"),
                user_val: r.get("user_val"),
            })
            .collect())
    }

    async fn insert_texts(&self, texts: &[TextRow]) -> StorageResult<()> {
        for t in texts {
            sqlx::query(
                "INSERT INTO texts (run_id, step, name, body) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING"
            )
            .bind(&t.run_id).bind(t.step).bind(&t.name).bind(&t.body)
            .execute(&self.pool).await?;
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
                 WHERE run_id = $1 AND ($2::bigint IS NULL OR step > $2)
                 ORDER BY step",
            )
            .bind(run_id)
            .bind(after_step)
            .fetch_all(&self.pool)
            .await?
        } else {
            sqlx::query(
                "SELECT run_id, step, name, body FROM texts
                 WHERE run_id = $1 AND name = $2 AND ($3::bigint IS NULL OR step > $3)
                 ORDER BY step",
            )
            .bind(run_id)
            .bind(name)
            .bind(after_step)
            .fetch_all(&self.pool)
            .await?
        };
        Ok(rows
            .iter()
            .map(|r| TextRow {
                run_id: r.get("run_id"),
                step: r.get("step"),
                name: r.get("name"),
                body: r.get("body"),
            })
            .collect())
    }

    async fn insert_figure(&self, fig: &FigureRow) -> StorageResult<()> {
        sqlx::query(
            "INSERT INTO figures (run_id, step, name, kind, body) VALUES ($1, $2, $3, $4, $5)",
        )
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
        let query = if name.is_some() {
            "SELECT run_id, step, name, kind, body FROM figures WHERE run_id = $1 AND name = $2 ORDER BY step"
        } else {
            "SELECT run_id, step, name, kind, body FROM figures WHERE run_id = $1 ORDER BY step"
        };
        let mut q = sqlx::query_as::<_, (String, i64, String, String, String)>(query).bind(run_id);
        if let Some(n) = name {
            q = q.bind(n);
        }
        let rows = q.fetch_all(&self.pool).await?;
        Ok(rows
            .iter()
            .map(|(run_id, step, name, kind, body)| FigureRow {
                run_id: run_id.clone(),
                step: *step,
                name: name.clone(),
                kind: kind.clone(),
                body: body.clone(),
            })
            .collect())
    }

    async fn insert_artifact(&self, _meta: &ArtifactMeta) -> StorageResult<()> {
        Ok(())
    }

    async fn insert_report(&self, r: &ReportRow) -> StorageResult<String> {
        let id = format!("report_{:x}", rand::random::<u64>());
        sqlx::query(
            "INSERT INTO reports (id, owner_id, project, title, body, created_at) VALUES ($1,$2,$3,$4,$5,$6)"
        )
        .bind(&id).bind(r.owner_id).bind(&r.project).bind(&r.title).bind(&r.body).bind(r.created_at)
        .execute(&self.pool).await?;
        Ok(id)
    }

    async fn update_report(&self, id: &str, title: &str, body: &str) -> StorageResult<()> {
        sqlx::query("UPDATE reports SET title = $1, body = $2 WHERE id = $3")
            .bind(title)
            .bind(body)
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    async fn delete_report(&self, id: &str) -> StorageResult<()> {
        sqlx::query("DELETE FROM reports WHERE id = $1")
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
        let rows = sqlx::query_as::<_, (String, Option<i64>, String, String, String, f64)>(
            "SELECT id, owner_id, project, title, body, created_at FROM reports
             WHERE ($1::text IS NULL OR project = $1)
               AND ($2::bigint IS NULL OR owner_id = $2)
             ORDER BY created_at DESC LIMIT $3 OFFSET $4",
        )
        .bind(project)
        .bind(owner_id)
        .bind(limit.unwrap_or(100))
        .bind(offset.unwrap_or(0))
        .fetch_all(&self.pool)
        .await?;
        Ok(rows
            .iter()
            .map(|(id, owner_id, proj, title, body, created_at)| ReportRow {
                id: Some(id.clone()),
                owner_id: *owner_id,
                project: proj.clone(),
                title: title.clone(),
                body: body.clone(),
                created_at: *created_at,
            })
            .collect())
    }

    async fn count_reports(&self, project: Option<&str>, owner_id: Option<i64>) -> StorageResult<u64> {
        let row = sqlx::query(
            "SELECT COUNT(*) FROM reports WHERE ($1::text IS NULL OR project = $1) AND ($2::bigint IS NULL OR owner_id = $2)",
        )
        .bind(project)
        .bind(owner_id)
        .fetch_one(&self.pool)
        .await?;
        Ok(row.get::<i64, _>("count") as u64)
    }

    async fn get_report(&self, id: &str) -> StorageResult<Option<ReportRow>> {
        let result = sqlx::query_as::<_, (String, Option<i64>, String, String, String, f64)>(
            "SELECT id, owner_id, project, title, body, created_at FROM reports WHERE id = $1",
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await?;
        Ok(
            result.map(|(id, owner_id, proj, title, body, created_at)| ReportRow {
                id: Some(id),
                owner_id,
                project: proj,
                title,
                body,
                created_at,
            }),
        )
    }

    // ── Explores ──
    async fn insert_explore(&self, e: &ExploreRow) -> StorageResult<String> {
        let id = format!("explore_{:x}", rand::random::<u64>());
        sqlx::query(
            "INSERT INTO explores (id, owner_id, project, title, description, run_ids, chart_defs, config, created_at, updated_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)"
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
            "UPDATE explores SET title = $1, description = $2, run_ids = $3, chart_defs = $4, config = $5, updated_at = $6 WHERE id = $7"
        )
        .bind(title).bind(description).bind(run_ids).bind(chart_defs).bind(config).bind(now).bind(id)
        .execute(&self.pool).await?;
        Ok(())
    }

    async fn delete_explore(&self, id: &str) -> StorageResult<()> {
        sqlx::query("DELETE FROM explores WHERE id = $1")
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
        let rows = sqlx::query(
            "SELECT id, owner_id, project, title, description, run_ids, chart_defs, config, created_at, updated_at
             FROM explores ORDER BY updated_at DESC"
        ).fetch_all(&self.pool).await?;
        let mut all: Vec<ExploreRow> = rows
            .iter()
            .map(|r| ExploreRow {
                id: Some(r.get::<String, _>("id")),
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
            .collect();
        all.retain(|x| owner_id == 0 || x.owner_id == owner_id);
        if let Some(p) = project {
            all.retain(|x| x.project == p);
        }
        let start = offset.unwrap_or(0) as usize;
        let per = limit.unwrap_or(100) as usize;
        Ok(all.into_iter().skip(start).take(per).collect())
    }

    async fn count_explores(&self, owner_id: i64, project: Option<&str>) -> StorageResult<u64> {
        let rows = sqlx::query("SELECT owner_id, project FROM explores")
            .fetch_all(&self.pool)
            .await?;
        let n = rows
            .iter()
            .filter(|r| {
                let oid: i64 = r.get("owner_id");
                let proj: String = r.get("project");
                (owner_id == 0 || oid == owner_id) && project.map_or(true, |p| proj == p)
            })
            .count();
        Ok(n as u64)
    }

    async fn get_explore(&self, id: &str) -> StorageResult<Option<ExploreRow>> {
        let rows = sqlx::query(
            "SELECT id, owner_id, project, title, description, run_ids, chart_defs, config, created_at, updated_at
             FROM explores WHERE id = $1"
        ).bind(id).fetch_all(&self.pool).await?;
        Ok(rows
            .iter()
            .map(|r| ExploreRow {
                id: Some(r.get::<String, _>("id")),
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
        let row: (i64,) = sqlx::query_as(
            "INSERT INTO tables (run_id, step, name, columns, data, row_count, created_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id",
        )
        .bind(&t.run_id)
        .bind(t.step)
        .bind(&t.name)
        .bind(&columns)
        .bind(&data)
        .bind(t.row_count)
        .bind(t.created_at)
        .fetch_one(&self.pool)
        .await?;
        Ok(row.0)
    }

    async fn query_tables(&self, run_id: &str, name: Option<&str>) -> StorageResult<Vec<TableRow>> {
        let query = if name.is_some() {
            "SELECT id, run_id, step, name, columns, data, row_count, created_at FROM tables WHERE run_id = $1 AND name = $2 ORDER BY step".to_string()
        } else {
            format!("SELECT id, run_id, step, name, columns, data, row_count, created_at FROM tables WHERE run_id = $1 ORDER BY step")
        };
        let mut q =
            sqlx::query_as::<_, (i64, String, i64, String, String, String, i64, f64)>(&query)
                .bind(run_id);
        if let Some(n) = name {
            q = q.bind(n);
        }
        let rows = q.fetch_all(&self.pool).await?;
        Ok(rows
            .iter()
            .map(
                |(id, run_id, step, name, cols, data, row_count, created_at)| TableRow {
                    id: Some(*id),
                    run_id: run_id.clone(),
                    step: *step,
                    name: name.clone(),
                    columns: serde_json::from_str(cols).unwrap_or_default(),
                    data: serde_json::from_str(data).unwrap_or(serde_json::Value::Null),
                    row_count: *row_count,
                    created_at: *created_at,
                },
            )
            .collect())
    }

    async fn get_table_by_id(&self, id: i64) -> StorageResult<Option<TableRow>> {
        let result = sqlx::query_as::<_, (i64,String,i64,String,String,String,i64,f64)>(
            "SELECT id, run_id, step, name, columns, data, row_count, created_at FROM tables WHERE id = $1"
        ).bind(id).fetch_optional(&self.pool).await?;
        Ok(result.map(
            |(id, run_id, step, name, cols, data, row_count, created_at)| TableRow {
                id: Some(id),
                run_id,
                step,
                name,
                columns: serde_json::from_str(&cols).unwrap_or_default(),
                data: serde_json::from_str(&data).unwrap_or(serde_json::Value::Null),
                row_count,
                created_at,
            },
        ))
    }

    async fn insert_media(&self, m: &MediaRow) -> StorageResult<i64> {
        let row: (i64,) = sqlx::query_as(
            "INSERT INTO media (run_id, step, name, kind, ext, hash, file_path, size, created_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id",
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
        .fetch_one(&self.pool)
        .await?;
        Ok(row.0)
    }

    async fn query_media(&self, run_id: &str, kind: Option<&str>) -> StorageResult<Vec<MediaRow>> {
        let result: Vec<MediaRow> = if let Some(k) = kind {
            sqlx::query_as::<
                _,
                (
                    i64,
                    String,
                    i64,
                    String,
                    String,
                    String,
                    String,
                    String,
                    i64,
                    f64,
                ),
            >(
                "SELECT id, run_id, step, name, kind, ext, hash, file_path, size, created_at
                 FROM media WHERE run_id = $1 AND kind = $2 ORDER BY step",
            )
            .bind(run_id)
            .bind(k)
            .fetch_all(&self.pool)
            .await?
            .into_iter()
            .map(|r| MediaRow {
                id: Some(r.0),
                run_id: r.1,
                step: r.2,
                name: r.3,
                kind: r.4,
                ext: r.5,
                hash: r.6,
                file_path: r.7,
                size: r.8,
                created_at: r.9,
            })
            .collect()
        } else {
            sqlx::query_as::<
                _,
                (
                    i64,
                    String,
                    i64,
                    String,
                    String,
                    String,
                    String,
                    String,
                    i64,
                    f64,
                ),
            >(
                "SELECT id, run_id, step, name, kind, ext, hash, file_path, size, created_at
                 FROM media WHERE run_id = $1 ORDER BY step",
            )
            .bind(run_id)
            .fetch_all(&self.pool)
            .await?
            .into_iter()
            .map(|r| MediaRow {
                id: Some(r.0),
                run_id: r.1,
                step: r.2,
                name: r.3,
                kind: r.4,
                ext: r.5,
                hash: r.6,
                file_path: r.7,
                size: r.8,
                created_at: r.9,
            })
            .collect()
        };
        Ok(result)
    }

    async fn get_media_by_id(&self, id: i64) -> StorageResult<Option<MediaRow>> {
        let result = sqlx::query_as::<
            _,
            (
                i64,
                String,
                i64,
                String,
                String,
                String,
                String,
                String,
                i64,
                f64,
            ),
        >(
            "SELECT id, run_id, step, name, kind, ext, hash, file_path, size, created_at
             FROM media WHERE id = $1",
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await?;
        Ok(result.map(|r| MediaRow {
            id: Some(r.0),
            run_id: r.1,
            step: r.2,
            name: r.3,
            kind: r.4,
            ext: r.5,
            hash: r.6,
            file_path: r.7,
            size: r.8,
            created_at: r.9,
        }))
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
        sqlx::query("INSERT INTO shares (token, resource_type, resource_id, created_at, expires_at) VALUES ($1, $2, $3, $4, $5)")
            .bind(token).bind(resource_type).bind(resource_id).bind(now).bind(expires_at)
            .execute(&self.pool).await?;
        Ok(())
    }

    async fn get_share(&self, token: &str) -> StorageResult<Option<(String, String, Option<f64>)>> {
        let row = sqlx::query_as::<_, (String, String, Option<f64>)>(
            "SELECT resource_type, resource_id, expires_at FROM shares WHERE token = $1",
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
            "SELECT token, resource_type, resource_id, created_at, expires_at FROM shares ORDER BY created_at DESC LIMIT $1 OFFSET $2"
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
        Ok(row.get::<i64, _>("count") as u64)
    }

    async fn delete_share(&self, token: &str) -> StorageResult<()> {
        sqlx::query("DELETE FROM shares WHERE token = $1")
            .bind(token)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    async fn update_share_expiry(&self, token: &str, expires_at: Option<f64>) -> StorageResult<()> {
        sqlx::query("UPDATE shares SET expires_at = $1 WHERE token = $2")
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
            sqlx::query("DELETE FROM shares WHERE expires_at IS NOT NULL AND expires_at < $1")
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
        sqlx::query("INSERT INTO api_tokens (token, user_id, name, created_at, expires_at) VALUES ($1, $2, $3, $4, $5)")
            .bind(token).bind(user_id).bind(name).bind(now).bind(expires_at)
            .execute(&self.pool).await?;
        Ok(())
    }

    async fn list_api_tokens(&self, user_id: i64) -> StorageResult<Vec<ApiToken>> {
        let rows = sqlx::query(
            "SELECT token, user_id, name, created_at, expires_at FROM api_tokens WHERE user_id = $1 ORDER BY created_at DESC"
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
        sqlx::query("DELETE FROM api_tokens WHERE token = $1")
            .bind(token)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    async fn delete_api_tokens_by_name(&self, name: &str) -> StorageResult<usize> {
        let res = sqlx::query("DELETE FROM api_tokens WHERE name = $1")
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
        sqlx::query("UPDATE api_tokens SET expires_at = $1 WHERE token = $2")
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
             WHERE t.token = $1 AND (t.expires_at IS NULL OR t.expires_at > $2)",
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
            "SELECT owner_id FROM runs WHERE project = $1 AND owner_id IS NOT NULL ORDER BY created_at LIMIT 1"
        ).bind(project).fetch_optional(&self.pool).await?;
        Ok(row.map(|r| r.0))
    }
}

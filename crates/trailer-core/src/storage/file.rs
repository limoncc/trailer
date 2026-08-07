//! File-based storage — TensorBoard-style directory layout.
//!
//! ```text
//! data/
//!   _users.json / _api_tokens.json / _shares.json / _reports.json
//!   [project]/
//!     .meta.json            ← {owner_id}
//!     [run_id]/
//!       run.json            ← RunMeta
//!       metrics/<key>@<ctx>.json
//!       histograms/<key>@<ctx>.json
//!       texts/<name>.json
//!       figures/<name>@<step>.json
//!       tables/<name>.json
//!       media/<name>@<step>.json
//! ```

use async_trait::async_trait;
use serde::de::DeserializeOwned;
use serde::Serialize;
use std::path::{Path, PathBuf};

use crate::domain::{
    ApiToken, ArtifactMeta, ExploreRow, FigureRow, HistogramRow, MediaRow, MetricQuery, MetricRow,
    ReportRow, RunFilter, RunMeta, ShareInfo, SummaryRow, TableRow, TextRow, UserRow,
};
use crate::error::{StorageError, StorageResult};
use crate::storage::Storage;

pub struct FileStorage {
    root: PathBuf,
}

impl FileStorage {
    pub async fn open(root: &str) -> StorageResult<Self> {
        let root = PathBuf::from(root);
        std::fs::create_dir_all(&root)?;
        Ok(Self { root })
    }

    // ── Path helpers ──

    fn run_dir(&self, project: &str, run_id: &str) -> PathBuf {
        self.root.join(project).join(run_id)
    }

    fn run_file(&self, project: &str, run_id: &str) -> PathBuf {
        self.run_dir(project, run_id).join("run.json")
    }

    fn metrics_file(&self, run_id: &str, project: &str, key: &str, context: &str) -> PathBuf {
        let name = format!("{}@{}.json", sanitize(key), sanitize(context));
        self.run_dir(project, run_id).join("metrics").join(name)
    }

    fn histograms_file(&self, run_id: &str, project: &str, key: &str, context: &str) -> PathBuf {
        let name = format!("{}@{}.json", sanitize(key), sanitize(context));
        self.run_dir(project, run_id).join("histograms").join(name)
    }

    fn texts_file(&self, run_id: &str, project: &str, name: &str) -> PathBuf {
        self.run_dir(project, run_id)
            .join("texts")
            .join(format!("{}.json", sanitize(name)))
    }

    fn figures_dir(&self, run_id: &str, project: &str) -> PathBuf {
        self.run_dir(project, run_id).join("figures")
    }

    fn tables_dir(&self, run_id: &str, project: &str) -> PathBuf {
        self.run_dir(project, run_id).join("tables")
    }

    fn media_dir(&self, run_id: &str, project: &str) -> PathBuf {
        self.run_dir(project, run_id).join("media")
    }

    /// 全局自增 id(_seq.json),用于 tables/media/reports/users。
    async fn next_id(&self) -> StorageResult<i64> {
        let seq_path = self.root.join("_seq.json");
        let n = self.read_json::<i64>(&seq_path).await?.unwrap_or(0) + 1;
        self.write_json(&seq_path, &n).await?;
        Ok(n)
    }

    /// 读全局 JSON 数组文件(不存在返回空)。
    async fn load_json<T: DeserializeOwned>(&self, name: &str) -> StorageResult<Vec<T>> {
        let path = self.root.join(name);
        Ok(self.read_json::<Vec<T>>(&path).await?.unwrap_or_default())
    }

    async fn save_json<T: Serialize>(&self, name: &str, value: &T) -> StorageResult<()> {
        self.write_json(&self.root.join(name), value).await
    }

    // ── Atomic JSON IO ──

    /// 原子写 JSON:临时文件 + rename,避免并发读到半写。
    async fn write_json<T: Serialize>(&self, path: &Path, value: &T) -> StorageResult<()> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let tmp = path.with_extension("json.tmp");
        let bytes = serde_json::to_vec(value)?;
        std::fs::write(&tmp, &bytes)?;
        std::fs::rename(&tmp, path)?;
        Ok(())
    }

    async fn read_json<T: DeserializeOwned>(&self, path: &Path) -> StorageResult<Option<T>> {
        if !path.exists() {
            return Ok(None);
        }
        let data = std::fs::read(path)?;
        Ok(Some(serde_json::from_slice(&data)?))
    }

    /// 扫描所有 run 目录(project/run_id/run.json)。
    async fn scan_runs(&self) -> StorageResult<Vec<RunMeta>> {
        let mut runs = Vec::new();
        let root = self.root.clone();
        let entries = std::fs::read_dir(&root)?;
        for proj in entries.flatten() {
            if !proj.path().is_dir() || is_global(&proj.file_name()) {
                continue;
            }
            let runs_dir = proj.path();
            for run in std::fs::read_dir(&runs_dir)? {
                let run = run?;
                if !run.path().is_dir() {
                    continue;
                }
                let run_file = run.path().join("run.json");
                if run_file.exists() {
                    if let Some(meta) = self.read_json::<RunMeta>(&run_file).await? {
                        runs.push(meta);
                    }
                }
            }
        }
        Ok(runs)
    }
}

fn sanitize(s: &str) -> String {
    s.replace(['/', '\\', ':', '*', '?', '"', '<', '>', '|'], "_")
}

/// 解析 "key@context.json" → (key, context);无 @ 时 context=""
fn parse_key_context(fname: &str) -> (String, String) {
    let stem = fname.strip_suffix(".json").unwrap_or(fname);
    if let Some(idx) = stem.rfind('@') {
        (stem[..idx].to_string(), stem[idx + 1..].to_string())
    } else {
        (stem.to_string(), String::new())
    }
}

fn is_global(name: &std::ffi::OsStr) -> bool {
    name.to_string_lossy().starts_with('_')
}

#[async_trait]
impl Storage for FileStorage {
    // ── Runs ──

    async fn upsert_run(&self, run: &RunMeta) -> StorageResult<()> {
        self.write_json(&self.run_file(&run.project, &run.run_id), run)
            .await
    }

    async fn list_runs(&self, filter: &RunFilter) -> StorageResult<Vec<RunMeta>> {
        let mut runs = self.scan_runs().await?;
        if let Some(ref project) = filter.project {
            runs.retain(|r| &r.project == project);
        }
        if let Some(ref state) = filter.state {
            runs.retain(|r| &r.state == state);
        }
        if let Some(owner) = filter.owner_id {
            runs.retain(|r| r.owner_id == Some(owner));
        }
        if let Some(ref sweep_id) = filter.sweep_id {
            runs.retain(|r| r.sweep_id.as_deref() == Some(sweep_id));
        }
        runs.sort_by(|a, b| {
            b.created_at
                .partial_cmp(&a.created_at)
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        if let Some(offset) = filter.offset {
            let offset = offset as usize;
            if offset >= runs.len() {
                runs.clear();
            } else {
                runs.drain(..offset);
            }
        }
        if let Some(limit) = filter.limit {
            runs.truncate(limit as usize);
        }
        Ok(runs)
    }

    async fn count_runs(&self, filter: &RunFilter) -> StorageResult<u64> {
        let mut runs = self.scan_runs().await?;
        if let Some(ref project) = filter.project {
            runs.retain(|r| &r.project == project);
        }
        if let Some(ref state) = filter.state {
            runs.retain(|r| &r.state == state);
        }
        if let Some(owner) = filter.owner_id {
            runs.retain(|r| r.owner_id == Some(owner));
        }
        if let Some(ref sweep_id) = filter.sweep_id {
            runs.retain(|r| r.sweep_id.as_deref() == Some(sweep_id));
        }
        Ok(runs.len() as u64)
    }

    async fn get_run(&self, run_id: &str) -> StorageResult<Option<RunMeta>> {
        // 需扫描找到 project(project 是目录)
        for meta in self.scan_runs().await? {
            if meta.run_id == run_id {
                return Ok(Some(meta));
            }
        }
        Ok(None)
    }

    async fn heartbeat(&self, run_id: &str, ts: f64) -> StorageResult<()> {
        for meta in self.scan_runs().await? {
            if meta.run_id == run_id {
                let mut updated = meta;
                updated.heartbeat_at = Some(ts);
                return self.upsert_run(&updated).await;
            }
        }
        Err(StorageError::NotFound(run_id.into()))
    }

    async fn delete_run(&self, run_id: &str) -> StorageResult<()> {
        for meta in self.scan_runs().await? {
            if meta.run_id == run_id {
                std::fs::remove_dir_all(self.run_dir(&meta.project, &meta.run_id))?;
                return Ok(());
            }
        }
        Err(StorageError::NotFound(run_id.into()))
    }

    // ── Metrics ──

    async fn insert_metrics(&self, records: &[MetricRow]) -> StorageResult<()> {
        use std::collections::HashMap;
        let mut groups: HashMap<(String, String, String), Vec<MetricRow>> = HashMap::new();
        for r in records {
            groups
                .entry((r.run_id.clone(), r.key.clone(), r.context.clone()))
                .or_default()
                .push(r.clone());
        }
        for ((run_id, key, context), mut rows) in groups {
            let run = self
                .get_run(&run_id)
                .await?
                .ok_or_else(|| StorageError::NotFound(run_id.clone()))?;
            let path = self.metrics_file(&run_id, &run.project, &key, &context);
            let mut existing = self
                .read_json::<Vec<MetricRow>>(&path)
                .await?
                .unwrap_or_default();
            existing.append(&mut rows);
            self.write_json(&path, &existing).await?;
        }
        Ok(())
    }

    async fn query_metrics(&self, q: &MetricQuery) -> StorageResult<Vec<MetricRow>> {
        let run_id = q
            .run_id
            .as_deref()
            .ok_or_else(|| StorageError::InvalidOperation("run_id required".into()))?;
        let run = self
            .get_run(run_id)
            .await?
            .ok_or_else(|| StorageError::NotFound(run_id.into()))?;
        let dir = self.run_dir(&run.project, run_id).join("metrics");
        let mut out = Vec::new();
        if dir.exists() {
            for entry in std::fs::read_dir(&dir)? {
                let entry = entry?;
                let fname = entry.file_name().to_string_lossy().to_string();
                if !fname.ends_with(".json") || fname.ends_with(".tmp") {
                    continue;
                }
                let (key, context) = parse_key_context(&fname);
                if let Some(fk) = &q.key {
                    if &key != fk {
                        continue;
                    }
                }
                if let Some(fc) = &q.context {
                    if &context != fc {
                        continue;
                    }
                }
                let mut rows = self
                    .read_json::<Vec<MetricRow>>(&entry.path())
                    .await?
                    .unwrap_or_default();
                // after_step 过滤(系统指标 step 独立 hw_step, 不受过滤, 保证实时显示)
                rows.retain(|r| {
                    if let Some(after) = q.after_step {
                        if r.step <= after && !r.key.starts_with("system/") {
                            return false;
                        }
                    }
                    true
                });
                rows.sort_by(|a, b| a.step.cmp(&b.step));
                // 每 metric 均匀采样到 q.max_points 个点(首/尾/每 k 个), 不截断历史
                if let Some(max) = q.max_points {
                    if rows.len() > max {
                        let total = rows.len();
                        let k = (total + max - 1) / max;
                        rows = rows
                            .iter()
                            .enumerate()
                            .filter(|(i, _)| *i == 0 || *i == total - 1 || *i % k == 0)
                            .map(|(_, r)| r.clone())
                            .collect();
                    }
                }
                out.extend(rows);
            }
        }
        out.sort_by(|a, b| a.step.cmp(&b.step));
        Ok(out)
    }

    async fn get_max_step(&self, run_id: &str) -> StorageResult<Option<i64>> {
        let run = match self.get_run(run_id).await? {
            Some(r) => r,
            None => return Ok(None),
        };
        let dir = self.run_dir(&run.project, run_id).join("metrics");
        let mut max = None;
        if dir.exists() {
            for entry in std::fs::read_dir(&dir)? {
                let entry = entry?;
                let fname = entry.file_name().to_string_lossy().to_string();
                if !fname.ends_with(".json") || fname.ends_with(".tmp") {
                    continue;
                }
                let rows = self
                    .read_json::<Vec<MetricRow>>(&entry.path())
                    .await?
                    .unwrap_or_default();
                for r in rows {
                    max = Some(max.map_or(r.step, |m: i64| m.max(r.step)));
                }
            }
        }
        Ok(max)
    }

    async fn delete_metrics_for_run(&self, run_id: &str) -> StorageResult<()> {
        if let Some(run) = self.get_run(run_id).await? {
            let dir = self.run_dir(&run.project, run_id).join("metrics");
            if dir.exists() {
                std::fs::remove_dir_all(&dir)?;
            }
        }
        Ok(())
    }

    // ── Histograms ──

    async fn insert_histograms(&self, records: &[HistogramRow]) -> StorageResult<()> {
        use std::collections::HashMap;
        let mut groups: HashMap<(String, String, String), Vec<HistogramRow>> = HashMap::new();
        for r in records {
            groups
                .entry((r.run_id.clone(), r.key.clone(), r.context.clone()))
                .or_default()
                .push(r.clone());
        }
        for ((run_id, key, context), mut rows) in groups {
            let run = self
                .get_run(&run_id)
                .await?
                .ok_or_else(|| StorageError::NotFound(run_id.clone()))?;
            let path = self.histograms_file(&run_id, &run.project, &key, &context);
            let mut existing = self
                .read_json::<Vec<HistogramRow>>(&path)
                .await?
                .unwrap_or_default();
            existing.append(&mut rows);
            self.write_json(&path, &existing).await?;
        }
        Ok(())
    }

    async fn query_histograms(
        &self,
        run_id: &str,
        key: Option<&str>,
        context: Option<&str>,
    ) -> StorageResult<Vec<HistogramRow>> {
        let run = match self.get_run(run_id).await? {
            Some(r) => r,
            None => return Ok(Vec::new()),
        };
        let dir = self.run_dir(&run.project, run_id).join("histograms");
        let mut out = Vec::new();
        if dir.exists() {
            for entry in std::fs::read_dir(&dir)? {
                let entry = entry?;
                let fname = entry.file_name().to_string_lossy().to_string();
                if !fname.ends_with(".json") || fname.ends_with(".tmp") {
                    continue;
                }
                let (k, c) = parse_key_context(&fname);
                if let Some(fk) = key {
                    if &k != fk {
                        continue;
                    }
                }
                if let Some(fc) = context {
                    if &c != fc {
                        continue;
                    }
                }
                let rows = self
                    .read_json::<Vec<HistogramRow>>(&entry.path())
                    .await?
                    .unwrap_or_default();
                out.extend(rows);
            }
        }
        out.sort_by(|a, b| a.step.cmp(&b.step));
        Ok(out)
    }

    async fn delete_histograms_for_run(&self, run_id: &str) -> StorageResult<()> {
        if let Some(run) = self.get_run(run_id).await? {
            let dir = self.run_dir(&run.project, run_id).join("histograms");
            if dir.exists() {
                std::fs::remove_dir_all(&dir)?;
            }
        }
        Ok(())
    }

    // ── Project Ownership ──

    async fn get_project_owner(&self, project: &str) -> StorageResult<Option<i64>> {
        let mut runs = self.scan_runs().await?;
        runs.retain(|r| &r.project == project);
        runs.sort_by(|a, b| {
            a.created_at
                .partial_cmp(&b.created_at)
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        Ok(runs.into_iter().find_map(|r| r.owner_id))
    }

    // ── Summary ──

    async fn upsert_summary(&self, summary: &[SummaryRow]) -> StorageResult<()> {
        for s in summary {
            let run = self
                .get_run(&s.run_id)
                .await?
                .ok_or_else(|| StorageError::NotFound(s.run_id.clone()))?;
            let path = self
                .run_dir(&run.project, &s.run_id)
                .join("summary")
                .join(format!(
                    "{}@{}.json",
                    sanitize(&s.key),
                    sanitize(&s.context)
                ));
            self.write_json(&path, s).await?;
        }
        Ok(())
    }

    async fn get_summary(&self, run_ids: &[String]) -> StorageResult<Vec<SummaryRow>> {
        let mut out = Vec::new();
        for rid in run_ids {
            if let Some(run) = self.get_run(rid).await? {
                let dir = self.run_dir(&run.project, rid).join("summary");
                if dir.exists() {
                    for entry in std::fs::read_dir(&dir)? {
                        let entry = entry?;
                        let fname = entry.file_name().to_string_lossy().to_string();
                        if !fname.ends_with(".json") || fname.ends_with(".tmp") {
                            continue;
                        }
                        if let Some(s) = self.read_json::<SummaryRow>(&entry.path()).await? {
                            out.push(s);
                        }
                    }
                }
            }
        }
        Ok(out)
    }

    // ── Texts ──

    async fn insert_texts(&self, texts: &[TextRow]) -> StorageResult<()> {
        use std::collections::HashMap;
        let mut groups: HashMap<(String, String), Vec<TextRow>> = HashMap::new();
        for t in texts {
            groups
                .entry((t.run_id.clone(), t.name.clone()))
                .or_default()
                .push(t.clone());
        }
        for ((run_id, name), mut rows) in groups {
            let run = self
                .get_run(&run_id)
                .await?
                .ok_or_else(|| StorageError::NotFound(run_id.clone()))?;
            let path = self.texts_file(&run_id, &run.project, &name);
            let mut existing = self
                .read_json::<Vec<TextRow>>(&path)
                .await?
                .unwrap_or_default();
            existing.append(&mut rows);
            self.write_json(&path, &existing).await?;
        }
        Ok(())
    }

    async fn query_texts(
        &self,
        run_id: &str,
        name: &str,
        after_step: Option<i64>,
    ) -> StorageResult<Vec<TextRow>> {
        let run = match self.get_run(run_id).await? {
            Some(r) => r,
            None => return Ok(Vec::new()),
        };
        let path = self.texts_file(run_id, &run.project, name);
        let rows = self
            .read_json::<Vec<TextRow>>(&path)
            .await?
            .unwrap_or_default();
        let mut out: Vec<TextRow> = rows
            .into_iter()
            .filter(|t| after_step.map_or(true, |a| t.step > a))
            .collect();
        out.sort_by(|a, b| a.step.cmp(&b.step));
        Ok(out)
    }

    // ── Figures ──

    async fn insert_figure(&self, fig: &FigureRow) -> StorageResult<()> {
        let run = self
            .get_run(&fig.run_id)
            .await?
            .ok_or_else(|| StorageError::NotFound(fig.run_id.clone()))?;
        let path = self.figures_dir(&fig.run_id, &run.project).join(format!(
            "{}@{}.json",
            sanitize(&fig.name),
            fig.step
        ));
        self.write_json(&path, fig).await
    }

    async fn query_figures(
        &self,
        run_id: &str,
        name: Option<&str>,
    ) -> StorageResult<Vec<FigureRow>> {
        let run = match self.get_run(run_id).await? {
            Some(r) => r,
            None => return Ok(Vec::new()),
        };
        let dir = self.figures_dir(run_id, &run.project);
        let mut out = Vec::new();
        if dir.exists() {
            for entry in std::fs::read_dir(&dir)? {
                let entry = entry?;
                let fname = entry.file_name().to_string_lossy().to_string();
                if !fname.ends_with(".json") || fname.ends_with(".tmp") {
                    continue;
                }
                let (fig_name, _) = parse_key_context(&fname);
                if let Some(n) = name {
                    if &fig_name != n {
                        continue;
                    }
                }
                if let Some(fig) = self.read_json::<FigureRow>(&entry.path()).await? {
                    out.push(fig);
                }
            }
        }
        out.sort_by(|a, b| a.step.cmp(&b.step));
        Ok(out)
    }

    // ── Users ──

    async fn insert_user(&self, user: &UserRow) -> StorageResult<i64> {
        let mut users = self.load_json::<UserRow>("_users.json").await?;
        if users.iter().any(|u| u.username == user.username) {
            return Err(StorageError::InvalidOperation(
                "username already exists".into(),
            ));
        }
        let id = self.next_id().await?;
        let mut u = user.clone();
        u.id = Some(id);
        users.push(u);
        self.save_json("_users.json", &users).await?;
        Ok(id)
    }

    async fn get_user_by_username(&self, username: &str) -> StorageResult<Option<UserRow>> {
        Ok(self
            .load_json::<UserRow>("_users.json")
            .await?
            .into_iter()
            .find(|u| u.username == username))
    }

    async fn get_user_by_id(&self, id: i64) -> StorageResult<Option<UserRow>> {
        Ok(self
            .load_json::<UserRow>("_users.json")
            .await?
            .into_iter()
            .find(|u| u.id == Some(id)))
    }

    async fn list_users(
        &self,
        limit: Option<i64>,
        offset: Option<i64>,
    ) -> StorageResult<Vec<UserRow>> {
        let users = self.load_json::<UserRow>("_users.json").await?;
        Ok(users
            .into_iter()
            .skip(offset.unwrap_or(0) as usize)
            .take(limit.unwrap_or(100) as usize)
            .collect())
    }

    async fn count_users(&self) -> StorageResult<u64> {
        Ok(self.load_json::<UserRow>("_users.json").await?.len() as u64)
    }

    async fn get_user_theme(&self, user_id: i64) -> StorageResult<String> {
        let users = self.load_json::<UserRow>("_users.json").await?;
        Ok(users
            .into_iter()
            .find(|u| u.id == Some(user_id))
            .map(|u| u.theme)
            .unwrap_or_else(|| "{}".into()))
    }

    async fn update_user_theme(&self, user_id: i64, theme_json: &str) -> StorageResult<()> {
        let mut users = self.load_json::<UserRow>("_users.json").await?;
        for u in users.iter_mut() {
            if u.id == Some(user_id) {
                u.theme = theme_json.into();
            }
        }
        self.save_json("_users.json", &users).await
    }

    async fn update_user_role(&self, id: i64, role: &str) -> StorageResult<()> {
        let mut users = self.load_json::<UserRow>("_users.json").await?;
        let mut found = false;
        for u in users.iter_mut() {
            if u.id == Some(id) {
                u.role = role.into();
                found = true;
            }
        }
        if found {
            self.save_json("_users.json", &users).await?;
        }
        Ok(())
    }

    async fn update_user_password(&self, id: i64, password: &str) -> StorageResult<()> {
        let mut users = self.load_json::<UserRow>("_users.json").await?;
        let mut found = false;
        for u in users.iter_mut() {
            if u.id == Some(id) {
                u.password = password.into();
                found = true;
            }
        }
        if found {
            self.save_json("_users.json", &users).await?;
        }
        Ok(())
    }

    async fn delete_user(&self, id: i64) -> StorageResult<()> {
        let mut users = self.load_json::<UserRow>("_users.json").await?;
        users.retain(|u| u.id != Some(id));
        self.save_json("_users.json", &users).await
    }

    // ── Reports ──

    async fn insert_report(&self, report: &ReportRow) -> StorageResult<String> {
        let mut reports = self.load_json::<ReportRow>("_reports.json").await?;
        let id = format!("report_{:x}", rand::random::<u64>());
        let mut r = report.clone();
        r.id = Some(id.clone());
        reports.push(r);
        self.save_json("_reports.json", &reports).await?;
        Ok(id)
    }

    async fn update_report(&self, id: &str, title: &str, body: &str) -> StorageResult<()> {
        let mut reports = self.load_json::<ReportRow>("_reports.json").await?;
        for r in reports.iter_mut() {
            if r.id.as_deref() == Some(id) {
                r.title = title.into();
                r.body = body.into();
            }
        }
        self.save_json("_reports.json", &reports).await
    }

    async fn delete_report(&self, id: &str) -> StorageResult<()> {
        let mut reports = self.load_json::<ReportRow>("_reports.json").await?;
        reports.retain(|r| r.id.as_deref() != Some(id));
        self.save_json("_reports.json", &reports).await
    }

    async fn list_reports(
        &self,
        project: Option<&str>,
        owner_id: Option<i64>,
        limit: Option<i64>,
        offset: Option<i64>,
    ) -> StorageResult<Vec<ReportRow>> {
        let reports = self.load_json::<ReportRow>("_reports.json").await?;
        let filtered: Vec<_> = reports
            .into_iter()
            .filter(|r| project.map_or(true, |p| r.project == p))
            .filter(|r| owner_id.map_or(true, |o| r.owner_id == Some(o)))
            .collect();
        Ok(filtered
            .into_iter()
            .skip(offset.unwrap_or(0) as usize)
            .take(limit.unwrap_or(100) as usize)
            .collect())
    }

    async fn count_reports(&self, project: Option<&str>, owner_id: Option<i64>) -> StorageResult<u64> {
        let reports = self.load_json::<ReportRow>("_reports.json").await?;
        Ok(reports
            .into_iter()
            .filter(|r| project.map_or(true, |p| r.project == p))
            .filter(|r| owner_id.map_or(true, |o| r.owner_id == Some(o)))
            .count() as u64)
    }

    async fn delete_runs_by_project(&self, project: &str) -> StorageResult<usize> {
        let runs = self.scan_runs().await?;
        let project_runs: Vec<_> = runs.into_iter().filter(|r| r.project == project).collect();
        let count = project_runs.len();
        for r in &project_runs {
            let dir = self.run_dir(&r.project, &r.run_id);
            let _ = std::fs::remove_dir_all(&dir);
        }
        // 清理项目目录
        let proj_dir = self.root.join(project);
        if proj_dir.exists() {
            let _ = std::fs::remove_dir_all(&proj_dir);
        }
        // 清理该项目 reports
        let mut reports = self.load_json::<ReportRow>("_reports.json").await?;
        reports.retain(|r| r.project != project);
        self.save_json("_reports.json", &reports).await?;
        Ok(count)
    }

    async fn get_report(&self, id: &str) -> StorageResult<Option<ReportRow>> {
        Ok(self
            .load_json::<ReportRow>("_reports.json")
            .await?
            .into_iter()
            .find(|r| r.id.as_deref() == Some(id)))
    }

    // ── Explores ──
    async fn insert_explore(&self, e: &ExploreRow) -> StorageResult<String> {
        let mut explores = self.load_json::<ExploreRow>("_explores.json").await?;
        let id = format!("explore_{:x}", rand::random::<u64>());
        let mut x = e.clone();
        x.id = Some(id.clone());
        explores.push(x);
        self.save_json("_explores.json", &explores).await?;
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
        let mut explores = self.load_json::<ExploreRow>("_explores.json").await?;
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs_f64();
        for x in explores.iter_mut() {
            if x.id.as_deref() == Some(id) {
                x.title = title.into();
                x.description = description.into();
                x.run_ids = run_ids.into();
                x.chart_defs = chart_defs.into();
                x.config = config.into();
                x.updated_at = now;
            }
        }
        self.save_json("_explores.json", &explores).await
    }

    async fn delete_explore(&self, id: &str) -> StorageResult<()> {
        let mut explores = self.load_json::<ExploreRow>("_explores.json").await?;
        explores.retain(|x| x.id.as_deref() != Some(id));
        self.save_json("_explores.json", &explores).await
    }

    async fn list_explores(
        &self,
        owner_id: i64,
        project: Option<&str>,
        limit: Option<i64>,
        offset: Option<i64>,
    ) -> StorageResult<Vec<ExploreRow>> {
        let explores = self.load_json::<ExploreRow>("_explores.json").await?;
        let filtered: Vec<_> = explores
            .into_iter()
            .filter(|x| owner_id == 0 || x.owner_id == owner_id)
            .filter(|x| project.map_or(true, |p| x.project == p))
            .collect();
        Ok(filtered
            .into_iter()
            .skip(offset.unwrap_or(0) as usize)
            .take(limit.unwrap_or(100) as usize)
            .collect())
    }

    async fn count_explores(&self, owner_id: i64, project: Option<&str>) -> StorageResult<u64> {
        let explores = self.load_json::<ExploreRow>("_explores.json").await?;
        Ok(explores
            .into_iter()
            .filter(|x| owner_id == 0 || x.owner_id == owner_id)
            .filter(|x| project.map_or(true, |p| x.project == p))
            .count() as u64)
    }

    async fn get_explore(&self, id: &str) -> StorageResult<Option<ExploreRow>> {
        Ok(self
            .load_json::<ExploreRow>("_explores.json")
            .await?
            .into_iter()
            .find(|x| x.id.as_deref() == Some(id)))
    }

    // ── Tables ──

    async fn insert_table(&self, table: &TableRow) -> StorageResult<i64> {
        let id = self.next_id().await?;
        let run = self
            .get_run(&table.run_id)
            .await?
            .ok_or_else(|| StorageError::NotFound(table.run_id.clone()))?;
        let mut t = table.clone();
        t.id = Some(id);
        let path = self.tables_dir(&table.run_id, &run.project).join(format!(
            "{}_{}.json",
            sanitize(&table.name),
            id
        ));
        self.write_json(&path, &t).await?;
        Ok(id)
    }

    async fn query_tables(&self, run_id: &str, name: Option<&str>) -> StorageResult<Vec<TableRow>> {
        let run = match self.get_run(run_id).await? {
            Some(r) => r,
            None => return Ok(Vec::new()),
        };
        let dir = self.tables_dir(run_id, &run.project);
        let mut out = Vec::new();
        if dir.exists() {
            for entry in std::fs::read_dir(&dir)? {
                let entry = entry?;
                let fname = entry.file_name().to_string_lossy().to_string();
                if !fname.ends_with(".json") || fname.ends_with(".tmp") {
                    continue;
                }
                if let Some(t) = self.read_json::<TableRow>(&entry.path()).await? {
                    if let Some(n) = name {
                        if &t.name != n {
                            continue;
                        }
                    }
                    out.push(t);
                }
            }
        }
        out.sort_by(|a, b| a.step.cmp(&b.step));
        Ok(out)
    }

    async fn get_table_by_id(&self, id: i64) -> StorageResult<Option<TableRow>> {
        for run in self.scan_runs().await? {
            let dir = self.tables_dir(&run.run_id, &run.project);
            if dir.exists() {
                for entry in std::fs::read_dir(&dir)? {
                    let entry = entry?;
                    let fname = entry.file_name().to_string_lossy().to_string();
                    if !fname.ends_with(".json") || fname.ends_with(".tmp") {
                        continue;
                    }
                    if let Some(t) = self.read_json::<TableRow>(&entry.path()).await? {
                        if t.id == Some(id) {
                            return Ok(Some(t));
                        }
                    }
                }
            }
        }
        Ok(None)
    }

    // ── Media ──

    async fn insert_media(&self, media: &MediaRow) -> StorageResult<i64> {
        let id = self.next_id().await?;
        let run = self
            .get_run(&media.run_id)
            .await?
            .ok_or_else(|| StorageError::NotFound(media.run_id.clone()))?;
        let mut m = media.clone();
        m.id = Some(id);
        let path = self.media_dir(&media.run_id, &run.project).join(format!(
            "{}_{}.json",
            sanitize(&media.name),
            id
        ));
        self.write_json(&path, &m).await?;
        Ok(id)
    }

    async fn query_media(&self, run_id: &str, kind: Option<&str>) -> StorageResult<Vec<MediaRow>> {
        let run = match self.get_run(run_id).await? {
            Some(r) => r,
            None => return Ok(Vec::new()),
        };
        let dir = self.media_dir(run_id, &run.project);
        let mut out = Vec::new();
        if dir.exists() {
            for entry in std::fs::read_dir(&dir)? {
                let entry = entry?;
                let fname = entry.file_name().to_string_lossy().to_string();
                if !fname.ends_with(".json") || fname.ends_with(".tmp") {
                    continue;
                }
                if let Some(m) = self.read_json::<MediaRow>(&entry.path()).await? {
                    if let Some(k) = kind {
                        if &m.kind != k {
                            continue;
                        }
                    }
                    out.push(m);
                }
            }
        }
        out.sort_by(|a, b| a.step.cmp(&b.step));
        Ok(out)
    }

    async fn get_media_by_id(&self, id: i64) -> StorageResult<Option<MediaRow>> {
        for run in self.scan_runs().await? {
            let dir = self.media_dir(&run.run_id, &run.project);
            if dir.exists() {
                for entry in std::fs::read_dir(&dir)? {
                    let entry = entry?;
                    let fname = entry.file_name().to_string_lossy().to_string();
                    if !fname.ends_with(".json") || fname.ends_with(".tmp") {
                        continue;
                    }
                    if let Some(m) = self.read_json::<MediaRow>(&entry.path()).await? {
                        if m.id == Some(id) {
                            return Ok(Some(m));
                        }
                    }
                }
            }
        }
        Ok(None)
    }

    // ── Artifacts ──

    async fn insert_artifact(&self, _meta: &ArtifactMeta) -> StorageResult<()> {
        Ok(())
    }

    // ── Shares ──

    async fn create_share(
        &self,
        token: &str,
        resource_type: &str,
        resource_id: &str,
        expires_at: Option<f64>,
    ) -> StorageResult<()> {
        let mut shares = self.load_json::<ShareInfo>("_shares.json").await?;
        if shares.iter().any(|s| s.token == token) {
            return Err(StorageError::InvalidOperation(
                "share token already exists".into(),
            ));
        }
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs_f64();
        shares.push(ShareInfo {
            token: token.into(),
            resource_type: resource_type.into(),
            resource_id: resource_id.into(),
            created_at: now,
            expires_at,
        });
        self.save_json("_shares.json", &shares).await
    }

    async fn get_share(&self, token: &str) -> StorageResult<Option<(String, String, Option<f64>)>> {
        Ok(self
            .load_json::<ShareInfo>("_shares.json")
            .await?
            .into_iter()
            .find(|s| s.token == token)
            .map(|s| (s.resource_type, s.resource_id, s.expires_at)))
    }

    async fn list_shares(
        &self,
        limit: Option<i64>,
        offset: Option<i64>,
    ) -> StorageResult<Vec<ShareInfo>> {
        let shares = self.load_json::<ShareInfo>("_shares.json").await?;
        Ok(shares
            .into_iter()
            .skip(offset.unwrap_or(0) as usize)
            .take(limit.unwrap_or(100) as usize)
            .collect())
    }

    async fn count_shares(&self) -> StorageResult<u64> {
        Ok(self.load_json::<ShareInfo>("_shares.json").await?.len() as u64)
    }

    async fn delete_share(&self, token: &str) -> StorageResult<()> {
        let mut shares = self.load_json::<ShareInfo>("_shares.json").await?;
        shares.retain(|s| s.token != token);
        self.save_json("_shares.json", &shares).await
    }

    async fn update_share_expiry(&self, token: &str, expires_at: Option<f64>) -> StorageResult<()> {
        let mut shares = self.load_json::<ShareInfo>("_shares.json").await?;
        for s in shares.iter_mut() {
            if s.token == token {
                s.expires_at = expires_at;
            }
        }
        self.save_json("_shares.json", &shares).await
    }

    async fn delete_expired_shares(&self) -> StorageResult<usize> {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs_f64();
        let mut shares = self.load_json::<ShareInfo>("_shares.json").await?;
        let before = shares.len();
        shares.retain(|s| s.expires_at.map_or(true, |e| e > now));
        let removed = before - shares.len();
        self.save_json("_shares.json", &shares).await?;
        Ok(removed)
    }

    // ── API Tokens ──

    async fn create_api_token(
        &self,
        token: &str,
        user_id: i64,
        name: Option<&str>,
        expires_at: Option<f64>,
    ) -> StorageResult<()> {
        let mut tokens = self.load_json::<ApiToken>("_api_tokens.json").await?;
        if tokens.iter().any(|t| t.token == token) {
            return Err(StorageError::InvalidOperation(
                "api token already exists".into(),
            ));
        }
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs_f64();
        tokens.push(ApiToken {
            token: token.into(),
            user_id,
            name: name.map(String::from),
            created_at: now,
            expires_at,
        });
        self.save_json("_api_tokens.json", &tokens).await
    }

    async fn list_api_tokens(&self, user_id: i64) -> StorageResult<Vec<ApiToken>> {
        Ok(self
            .load_json::<ApiToken>("_api_tokens.json")
            .await?
            .into_iter()
            .filter(|t| t.user_id == user_id)
            .collect())
    }

    async fn delete_api_token(&self, token: &str) -> StorageResult<()> {
        let mut tokens = self.load_json::<ApiToken>("_api_tokens.json").await?;
        tokens.retain(|t| t.token != token);
        self.save_json("_api_tokens.json", &tokens).await
    }

    async fn delete_api_tokens_by_name(&self, name: &str) -> StorageResult<usize> {
        let mut tokens = self.load_json::<ApiToken>("_api_tokens.json").await?;
        let before = tokens.len();
        tokens.retain(|t| t.name.as_deref() != Some(name));
        let removed = before - tokens.len();
        self.save_json("_api_tokens.json", &tokens).await?;
        Ok(removed)
    }

    async fn update_api_token_expiry(
        &self,
        token: &str,
        expires_at: Option<f64>,
    ) -> StorageResult<()> {
        let mut tokens = self.load_json::<ApiToken>("_api_tokens.json").await?;
        for t in tokens.iter_mut() {
            if t.token == token {
                t.expires_at = expires_at;
            }
        }
        self.save_json("_api_tokens.json", &tokens).await
    }

    async fn get_user_by_api_token(&self, token: &str) -> StorageResult<Option<UserRow>> {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs_f64();
        let tokens = self.load_json::<ApiToken>("_api_tokens.json").await?;
        let found = tokens
            .into_iter()
            .find(|t| t.token == token && t.expires_at.map_or(true, |e| e > now));
        match found {
            Some(t) => self.get_user_by_id(t.user_id).await,
            None => Ok(None),
        }
    }
}

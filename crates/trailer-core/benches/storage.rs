use criterion::{black_box, criterion_group, criterion_main, Criterion};
use std::sync::Arc;
use trailer_core::domain::{MetricQuery, MetricRow, RunFilter, RunMeta};
use trailer_core::storage::Storage;

/// Create an in-memory SQLite store with a pre-inserted run.
async fn setup_store() -> (Arc<dyn Storage>, String) {
    let store = trailer_core::storage::new_sqlite_storage("sqlite::memory:")
        .await
        .expect("in-memory SQLite");
    let run_id = "bench-run";
    store
        .upsert_run(&RunMeta {
            run_id: run_id.into(),
            project: "bench".into(),
            group_name: None,
            name: Some("bench".into()),
            state: "running".into(),
            config: serde_json::json!({}),
            env: serde_json::json!({}),
            git_commit: None,
            sweep_id: None,
            created_at: 1000.0,
            heartbeat_at: None,
            tags: None,
            owner_id: None,
        })
        .await
        .expect("upsert run");
    (store, run_id.into())
}

/// Generate `count` metric rows for the given run.
fn make_metrics(run_id: &str, count: usize) -> Vec<MetricRow> {
    (0..count)
        .map(|i| MetricRow {
            run_id: run_id.into(),
            step: i as i64,
            wall_time: 1000.0 + i as f64,
            key: "loss".into(),
            context: "train".into(),
            value: 1.0 / (i as f64 + 1.0),
        })
        .collect()
}

fn bench_insert_metrics_100(c: &mut Criterion) {
    let rt = tokio::runtime::Runtime::new().unwrap();
    let (store, run_id) = rt.block_on(setup_store());
    let metrics = make_metrics(&run_id, 100);

    c.bench_function("insert_metrics/100_rows", |b| {
        b.iter(|| rt.block_on(store.insert_metrics(black_box(&metrics))))
    });
}

fn bench_insert_metrics_1000(c: &mut Criterion) {
    let rt = tokio::runtime::Runtime::new().unwrap();
    let (store, run_id) = rt.block_on(setup_store());
    let metrics = make_metrics(&run_id, 1_000);

    c.bench_function("insert_metrics/1k_rows", |b| {
        b.iter(|| rt.block_on(store.insert_metrics(black_box(&metrics))))
    });
}

fn bench_insert_metrics_10000(c: &mut Criterion) {
    let rt = tokio::runtime::Runtime::new().unwrap();
    let (store, run_id) = rt.block_on(setup_store());
    let metrics = make_metrics(&run_id, 10_000);

    c.bench_function("insert_metrics/10k_rows", |b| {
        b.iter(|| rt.block_on(store.insert_metrics(black_box(&metrics))))
    });
}

fn bench_query_metrics(c: &mut Criterion) {
    let rt = tokio::runtime::Runtime::new().unwrap();
    let (store, run_id) = rt.block_on(setup_store());
    let metrics = make_metrics(&run_id, 10_000);
    rt.block_on(store.insert_metrics(&metrics)).unwrap();

    let q = MetricQuery {
        run_id: Some(run_id.clone()),
        key: Some("loss".into()),
        context: Some("train".into()),
        after_step: None,
        max_points: None,
        downsample: false,
    };

    c.bench_function("query_metrics/10k_rows", |b| {
        b.iter(|| rt.block_on(store.query_metrics(black_box(&q))))
    });
}

fn bench_list_runs_100(c: &mut Criterion) {
    let rt = tokio::runtime::Runtime::new().unwrap();
    let store = rt.block_on(async {
        let store = trailer_core::storage::new_sqlite_storage("sqlite::memory:")
            .await
            .expect("in-memory SQLite");
        for i in 0..100 {
            store
                .upsert_run(&RunMeta {
                    run_id: format!("run-{}", i),
                    project: "bench".into(),
                    group_name: None,
                    name: None,
                    state: "finished".into(),
                    config: serde_json::json!({}),
                    env: serde_json::json!({}),
                    git_commit: None,
                    sweep_id: None,
                    created_at: 1000.0 + i as f64,
                    heartbeat_at: None,
                    tags: None,
                    owner_id: None,
                })
                .await
                .expect("upsert");
        }
        store
    });

    let filter = RunFilter {
        project: Some("bench".into()),
        state: None,
        sweep_id: None,
        expr: None,
        limit: None,
        offset: None,
        owner_id: None,
    };

    c.bench_function("list_runs/100", |b| {
        b.iter(|| rt.block_on(store.list_runs(black_box(&filter))))
    });
}

fn bench_list_runs_1000(c: &mut Criterion) {
    let rt = tokio::runtime::Runtime::new().unwrap();
    let store = rt.block_on(async {
        let store = trailer_core::storage::new_sqlite_storage("sqlite::memory:")
            .await
            .expect("in-memory SQLite");
        for i in 0..1000 {
            store
                .upsert_run(&RunMeta {
                    run_id: format!("run-{}", i),
                    project: "bench".into(),
                    group_name: None,
                    name: None,
                    state: "finished".into(),
                    config: serde_json::json!({}),
                    env: serde_json::json!({}),
                    git_commit: None,
                    sweep_id: None,
                    created_at: 1000.0 + i as f64,
                    heartbeat_at: None,
                    tags: None,
                    owner_id: None,
                })
                .await
                .expect("upsert");
        }
        store
    });

    let filter = RunFilter {
        project: Some("bench".into()),
        state: None,
        sweep_id: None,
        expr: None,
        limit: None,
        offset: None,
        owner_id: None,
    };

    c.bench_function("list_runs/1000", |b| {
        b.iter(|| rt.block_on(store.list_runs(black_box(&filter))))
    });
}

criterion_group!(
    name = storage;
    config = Criterion::default().sample_size(50).confidence_level(0.95);
    targets = bench_insert_metrics_100, bench_insert_metrics_1000, bench_insert_metrics_10000,
              bench_query_metrics, bench_list_runs_100, bench_list_runs_1000
);
criterion_main!(storage);

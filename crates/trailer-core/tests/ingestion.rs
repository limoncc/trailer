use std::collections::HashMap;
use tokio::sync::mpsc;
/// Integration test: full ingestion pipeline from Channel → Writer → SQLite.
/// Feeds 10,000 synthetic metric envelopes and verifies they land correctly.
use trailer_core::domain::{Envelope, FigureRow, MediaRow, MetricQuery, TableRow};
use trailer_core::ingest::run_ingestion_writer;
use trailer_core::storage::new_sqlite_storage;

#[tokio::test]
async fn ingest_10k_metrics_and_query_back() {
    // 1. Setup: in-memory SQLite
    let store = new_sqlite_storage("sqlite::memory:")
        .await
        .expect("open sqlite");

    // 2. Create channel and start writer
    let (tx, rx) = mpsc::channel::<Vec<Envelope>>(10_000);
    let write_store = store.clone();
    let writer_handle = tokio::spawn(async move {
        run_ingestion_writer(rx, write_store).await;
    });

    // 3. Feed 10,000 metric envelopes (100 batches of 100)
    for batch_id in 0..100 {
        let mut batch = Vec::with_capacity(100);
        for i in 0..100 {
            let mut payload = HashMap::new();
            payload.insert(
                "train/loss".into(),
                serde_json::json!(1.0 / (i as f64 + 1.0)),
            );
            payload.insert(
                "lr".into(),
                serde_json::json!(0.001 * (batch_id + 1) as f64),
            );

            batch.push(Envelope {
                kind: "metric".into(),
                run_id: "test-run".into(),
                step: (batch_id * 100 + i) as i64,
                wall_time: 1000.0 + batch_id as f64 * 100.0 + i as f64,
                context: String::new(),
                payload,
            });
        }
        tx.send(batch).await.expect("channel send");
    }
    drop(tx); // signal writer to finish

    // 4. Wait for writer to complete
    writer_handle.await.expect("writer panicked");

    // 5. Query back and verify
    let q = MetricQuery {
        run_id: Some("test-run".into()),
        key: Some("loss".into()),
        context: Some("train".into()),
        ..Default::default()
    };
    let rows = store.query_metrics(&q).await.expect("query");
    assert_eq!(rows.len(), 10_000, "should have 10,000 metric rows");
    assert_eq!(rows[0].step, 0);
    assert_eq!(rows[9999].step, 9_999);
    assert!(
        (rows[0].value - 1.0).abs() < 1e-9,
        "first loss should be 1.0"
    );

    // Verify lr values (no context)
    let lr_q = MetricQuery {
        run_id: Some("test-run".into()),
        key: Some("lr".into()),
        context: Some("".into()),
        ..Default::default()
    };
    let lr_rows = store.query_metrics(&lr_q).await.expect("lr query");
    assert_eq!(lr_rows.len(), 10_000);
}

#[tokio::test]
async fn figure_round_trip() {
    let store = new_sqlite_storage("sqlite::memory:")
        .await
        .expect("open sqlite");

    // Insert PNG figure
    let png = FigureRow {
        run_id: "r1".into(),
        step: 0,
        name: "chart".into(),
        kind: "png".into(),
        body: "base64pseudodata".into(),
    };
    store.insert_figure(&png).await.expect("insert");

    // Insert G2 figure
    let g2 = FigureRow {
        run_id: "r1".into(),
        step: 1,
        name: "curve".into(),
        kind: "g2".into(),
        body: r#"{"type":"line"}"#.into(),
    };
    store.insert_figure(&g2).await.expect("insert g2");

    // Query all
    let all = store.query_figures("r1", None).await.expect("query");
    assert_eq!(all.len(), 2);
    assert_eq!(all[0].kind, "png");
    assert_eq!(all[1].name, "curve");

    // Query by name
    let named = store
        .query_figures("r1", Some("chart"))
        .await
        .expect("filter");
    assert_eq!(named.len(), 1);
    assert_eq!(named[0].kind, "png");

    // Query unknown name
    let empty = store
        .query_figures("r1", Some("nonexistent"))
        .await
        .expect("empty");
    assert!(empty.is_empty());

    // Query unknown run
    let unknown = store
        .query_figures("nonexistent", None)
        .await
        .expect("unknown");
    assert!(unknown.is_empty());
}

#[tokio::test]
async fn media_round_trip() {
    let store = new_sqlite_storage("sqlite::memory:")
        .await
        .expect("open sqlite");

    let now = 1000.0;
    let media = MediaRow {
        id: None,
        run_id: "r1".into(),
        step: 0,
        name: "screenshot".into(),
        kind: "image".into(),
        ext: "png".into(),
        hash: "abc123".into(),
        file_path: "media/r1/screenshot_0_abc123.png".into(),
        size: 1024,
        created_at: now,
    };

    let id = store.insert_media(&media).await.expect("insert media");
    assert!(id > 0, "should return auto-increment id");

    // Query all
    let all = store.query_media("r1", None).await.expect("query all");
    assert_eq!(all.len(), 1);
    assert_eq!(all[0].name, "screenshot");
    assert_eq!(all[0].kind, "image");

    // Query by kind
    let images = store
        .query_media("r1", Some("image"))
        .await
        .expect("query image");
    assert_eq!(images.len(), 1);
    let videos = store
        .query_media("r1", Some("video"))
        .await
        .expect("query video");
    assert!(videos.is_empty());

    // Get by id
    let fetched = store.get_media_by_id(id).await.expect("get by id");
    assert!(fetched.is_some());
    assert_eq!(fetched.unwrap().hash, "abc123");
}

#[tokio::test]
async fn table_round_trip() {
    let store = new_sqlite_storage("sqlite::memory:")
        .await
        .expect("open sqlite");

    let now = 1000.0;
    let table = TableRow {
        id: None,
        run_id: "r1".into(),
        step: 0,
        name: "metrics_summary".into(),
        columns: vec!["epoch".into(), "loss".into(), "acc".into()],
        data: serde_json::json!([[0, 0.5, 0.85], [1, 0.3, 0.92], [2, 0.2, 0.95]]),
        row_count: 3,
        created_at: now,
    };

    let id = store.insert_table(&table).await.expect("insert table");
    assert!(id > 0);

    // Query all
    let all = store.query_tables("r1", None).await.expect("query all");
    assert_eq!(all.len(), 1);
    assert_eq!(all[0].name, "metrics_summary");
    assert_eq!(all[0].columns.len(), 3);
    assert_eq!(all[0].row_count, 3);

    // Get by id
    let fetched = store.get_table_by_id(id).await.expect("get by id");
    assert!(fetched.is_some());
    let t = fetched.unwrap();
    assert_eq!(t.columns[1], "loss");
    assert_eq!(t.data[0][1], 0.5);

    // Query by name
    let named = store
        .query_tables("r1", Some("metrics_summary"))
        .await
        .expect("filter");
    assert_eq!(named.len(), 1);

    // Query unknown name
    let empty = store
        .query_tables("r1", Some("nonexistent"))
        .await
        .expect("empty");
    assert!(empty.is_empty());
}

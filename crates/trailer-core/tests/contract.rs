use std::sync::Arc;
/// Contract tests for the Storage trait.
/// These tests run against both SQLite and PostgreSQL backends
/// to guarantee identical behavior.
use trailer_core::domain::{
    ExploreRow, FigureRow, HistogramRow, MediaRow, MetricQuery, MetricRow, ReportRow, RunFilter,
    RunMeta, SummaryRow, TableRow, TextRow,
};
use trailer_core::storage::Storage;

// ─── SQLite contract ───
#[tokio::test]
async fn sqlite_insert_and_query_metrics() {
    let store = trailer_core::storage::new_sqlite_storage("sqlite::memory:")
        .await
        .expect("failed to open in-memory SQLite");
    run_contract_tests(store).await;
}

// ─── File storage contract(逐步扩展)───

fn file_tmp_dir(name: &str) -> std::path::PathBuf {
    std::env::temp_dir().join(format!("rt_file_{}_{}", std::process::id(), name))
}

async fn file_store(name: &str) -> Arc<dyn Storage> {
    let dir = file_tmp_dir(name);
    let _ = std::fs::remove_dir_all(&dir);
    let store = trailer_core::storage::new_file_storage(dir.to_str().unwrap())
        .await
        .expect("failed to open file storage");
    store
}

fn cleanup(name: &str) {
    let _ = std::fs::remove_dir_all(file_tmp_dir(name));
}

#[tokio::test]
async fn file_storage_runs() {
    let store = file_store("runs").await;

    // upsert + get
    let run = RunMeta {
        run_id: "r1".into(),
        project: "p1".into(),
        group_name: None,
        name: Some("demo".into()),
        state: "running".into(),
        config: serde_json::json!({"lr": 0.01}),
        env: serde_json::json!({}),
        git_commit: None,
        sweep_id: None,
        created_at: 1000.0,
        heartbeat_at: Some(1000.0),
        tags: None,
        owner_id: Some(1),
    };
    store.upsert_run(&run).await.expect("upsert r1");
    let got = store.get_run("r1").await.expect("get r1").expect("found");
    assert_eq!(got.project, "p1");
    assert_eq!(got.config["lr"], 0.01);

    // list:全量 / project 过滤 / owner 过滤
    let all = store
        .list_runs(&RunFilter {
            ..Default::default()
        })
        .await
        .expect("list all");
    assert_eq!(all.len(), 1);
    let by_proj = store
        .list_runs(&RunFilter {
            project: Some("p1".into()),
            ..Default::default()
        })
        .await
        .expect("list p1");
    assert_eq!(by_proj.len(), 1);
    let mine = store
        .list_runs(&RunFilter {
            owner_id: Some(1),
            ..Default::default()
        })
        .await
        .expect("list owner");
    assert_eq!(mine.len(), 1);
    let others = store
        .list_runs(&RunFilter {
            owner_id: Some(2),
            ..Default::default()
        })
        .await
        .expect("list owner2");
    assert!(others.is_empty());

    // upsert 覆盖 + heartbeat
    let mut updated = run.clone();
    updated.state = "finished".into();
    store.upsert_run(&updated).await.expect("upsert updated");
    assert_eq!(
        store
            .get_run("r1")
            .await
            .expect("get upd")
            .expect("found")
            .state,
        "finished"
    );
    store.heartbeat("r1", 2000.0).await.expect("heartbeat");
    assert_eq!(
        store
            .get_run("r1")
            .await
            .expect("get hb")
            .expect("found")
            .heartbeat_at,
        Some(2000.0)
    );

    // delete
    store.delete_run("r1").await.expect("delete");
    assert!(store.get_run("r1").await.expect("get del").is_none());

    cleanup("runs");
}

#[tokio::test]
async fn file_storage_metrics() {
    let store = file_store("metrics").await;

    let run = RunMeta {
        run_id: "m1".into(),
        project: "mp".into(),
        group_name: None,
        name: None,
        state: "running".into(),
        config: serde_json::json!({}),
        env: serde_json::json!({}),
        git_commit: None,
        sweep_id: None,
        created_at: 1000.0,
        heartbeat_at: None,
        tags: None,
        owner_id: Some(1),
    };
    store.upsert_run(&run).await.expect("upsert run");

    let metrics: Vec<MetricRow> = (0..5)
        .map(|i| MetricRow {
            run_id: "m1".into(),
            step: i,
            wall_time: 1000.0 + i as f64,
            key: "loss".into(),
            context: "train".into(),
            value: 1.0 / (i as f64 + 1.0),
        })
        .collect();
    store
        .insert_metrics(&metrics)
        .await
        .expect("insert metrics");
    store
        .insert_metrics(&[MetricRow {
            run_id: "m1".into(),
            step: 0,
            wall_time: 2000.0,
            key: "acc".into(),
            context: "val".into(),
            value: 0.9,
        }])
        .await
        .expect("insert acc");

    // query:全量 / key / context / after_step
    let all = store
        .query_metrics(&MetricQuery {
            run_id: Some("m1".into()),
            ..Default::default()
        })
        .await
        .expect("query all");
    assert_eq!(all.len(), 6, "5 loss + 1 acc");
    let loss = store
        .query_metrics(&MetricQuery {
            run_id: Some("m1".into()),
            key: Some("loss".into()),
            ..Default::default()
        })
        .await
        .expect("query loss");
    assert_eq!(loss.len(), 5);
    let after = store
        .query_metrics(&MetricQuery {
            run_id: Some("m1".into()),
            key: Some("loss".into()),
            after_step: Some(2),
            ..Default::default()
        })
        .await
        .expect("query after");
    assert_eq!(after.len(), 2, "steps 3,4");
    assert!(after.iter().all(|m| m.step > 2));

    // get_max_step
    assert_eq!(store.get_max_step("m1").await.expect("max step"), Some(4));
    assert_eq!(store.get_max_step("nope").await.expect("max nope"), None);

    // delete_metrics_for_run
    store
        .delete_metrics_for_run("m1")
        .await
        .expect("delete metrics");
    let empty = store
        .query_metrics(&MetricQuery {
            run_id: Some("m1".into()),
            ..Default::default()
        })
        .await
        .expect("query empty");
    assert!(empty.is_empty());

    cleanup("metrics");
}

#[tokio::test]
async fn file_storage_owner_and_summary() {
    let store = file_store("summary").await;

    let run1 = RunMeta {
        run_id: "s1".into(),
        project: "sp".into(),
        group_name: None,
        name: None,
        state: "running".into(),
        config: serde_json::json!({}),
        env: serde_json::json!({}),
        git_commit: None,
        sweep_id: None,
        created_at: 1000.0,
        heartbeat_at: None,
        tags: None,
        owner_id: Some(7),
    };
    let run2 = RunMeta {
        run_id: "s2".into(),
        project: "sp2".into(),
        group_name: None,
        name: None,
        state: "running".into(),
        config: serde_json::json!({}),
        env: serde_json::json!({}),
        git_commit: None,
        sweep_id: None,
        created_at: 2000.0,
        heartbeat_at: None,
        tags: None,
        owner_id: Some(9),
    };
    store.upsert_run(&run1).await.expect("upsert s1");
    store.upsert_run(&run2).await.expect("upsert s2");

    // project owner = 项目下第一个 run 的 owner
    assert_eq!(
        store.get_project_owner("sp").await.expect("owner sp"),
        Some(7)
    );
    assert_eq!(
        store.get_project_owner("sp2").await.expect("owner sp2"),
        Some(9)
    );
    assert_eq!(
        store.get_project_owner("nope").await.expect("owner nope"),
        None
    );

    // summary upsert + get
    let summaries = vec![
        SummaryRow {
            run_id: "s1".into(),
            key: "loss".into(),
            context: "train".into(),
            last: Some(0.5),
            best: Some(0.1),
            best_step: Some(3),
            min_val: Some(0.1),
            max_val: Some(0.9),
            user_val: None,
        },
        SummaryRow {
            run_id: "s1".into(),
            key: "acc".into(),
            context: "val".into(),
            last: Some(0.9),
            best: Some(0.95),
            best_step: Some(4),
            min_val: Some(0.5),
            max_val: Some(0.95),
            user_val: None,
        },
    ];
    store
        .upsert_summary(&summaries)
        .await
        .expect("upsert summary");
    let got = store
        .get_summary(&["s1".into()])
        .await
        .expect("get summary");
    assert_eq!(got.len(), 2);
    assert!(got.iter().any(|s| s.key == "loss" && s.best == Some(0.1)));
    assert!(got.iter().any(|s| s.key == "acc" && s.last == Some(0.9)));

    // 覆写
    store
        .upsert_summary(&[SummaryRow {
            run_id: "s1".into(),
            key: "loss".into(),
            context: "train".into(),
            last: Some(0.6),
            best: Some(0.2),
            best_step: Some(5),
            min_val: Some(0.1),
            max_val: Some(0.9),
            user_val: None,
        }])
        .await
        .expect("re-upsert summary");
    let got = store
        .get_summary(&["s1".into()])
        .await
        .expect("get summary2");
    let loss = got.iter().find(|s| s.key == "loss").expect("loss summary");
    assert_eq!(loss.last, Some(0.6));

    cleanup("summary");
}

#[tokio::test]
async fn file_storage_texts_and_figures() {
    let store = file_store("texts_figs").await;

    let run = RunMeta {
        run_id: "tf1".into(),
        project: "tfp".into(),
        group_name: None,
        name: None,
        state: "running".into(),
        config: serde_json::json!({}),
        env: serde_json::json!({}),
        git_commit: None,
        sweep_id: None,
        created_at: 1000.0,
        heartbeat_at: None,
        tags: None,
        owner_id: Some(1),
    };
    store.upsert_run(&run).await.expect("upsert run");

    // texts
    store
        .insert_texts(&[
            TextRow {
                run_id: "tf1".into(),
                step: 1,
                name: "chat".into(),
                body: "hello".into(),
            },
            TextRow {
                run_id: "tf1".into(),
                step: 2,
                name: "chat".into(),
                body: "world".into(),
            },
            TextRow {
                run_id: "tf1".into(),
                step: 0,
                name: "other".into(),
                body: "x".into(),
            },
        ])
        .await
        .expect("insert texts");
    let chat = store
        .query_texts("tf1", "chat", None)
        .await
        .expect("query chat");
    assert_eq!(chat.len(), 2);
    assert!(chat.iter().all(|t| t.name == "chat"));
    let after = store
        .query_texts("tf1", "chat", Some(1))
        .await
        .expect("query after");
    assert_eq!(after.len(), 1);
    assert_eq!(after[0].body, "world");

    // figures
    let fig1 = FigureRow {
        run_id: "tf1".into(),
        step: 0,
        name: "loss_curve".into(),
        kind: "g2".into(),
        body: r#"{"type":"line"}"#.into(),
    };
    let fig2 = FigureRow {
        run_id: "tf1".into(),
        step: 1,
        name: "loss_curve".into(),
        kind: "g2".into(),
        body: r#"{"type":"line2"}"#.into(),
    };
    store.insert_figure(&fig1).await.expect("insert fig1");
    store.insert_figure(&fig2).await.expect("insert fig2");
    let figs = store.query_figures("tf1", None).await.expect("query figs");
    assert_eq!(figs.len(), 2);
    let loss = store
        .query_figures("tf1", Some("loss_curve"))
        .await
        .expect("query loss figs");
    assert_eq!(loss.len(), 2);
    let none = store
        .query_figures("tf1", Some("nope"))
        .await
        .expect("query none");
    assert!(none.is_empty());

    cleanup("texts_figs");
}

#[tokio::test]
async fn file_storage_tables_and_media() {
    let store = file_store("tables_media").await;

    let run = RunMeta {
        run_id: "tm1".into(),
        project: "tmp".into(),
        group_name: None,
        name: None,
        state: "running".into(),
        config: serde_json::json!({}),
        env: serde_json::json!({}),
        git_commit: None,
        sweep_id: None,
        created_at: 1000.0,
        heartbeat_at: None,
        tags: None,
        owner_id: Some(1),
    };
    store.upsert_run(&run).await.expect("upsert run");

    // tables
    let id1 = store
        .insert_table(&TableRow {
            id: None,
            run_id: "tm1".into(),
            step: 0,
            name: "metrics".into(),
            columns: vec!["a".into(), "b".into()],
            data: serde_json::json!([[1, 2], [3, 4]]),
            row_count: 2,
            created_at: 1000.0,
        })
        .await
        .expect("insert table1");
    let id2 = store
        .insert_table(&TableRow {
            id: None,
            run_id: "tm1".into(),
            step: 1,
            name: "metrics".into(),
            columns: vec!["x".into()],
            data: serde_json::json!([[5]]),
            row_count: 1,
            created_at: 2000.0,
        })
        .await
        .expect("insert table2");
    assert_ne!(id1, id2, "ids should differ");
    let tables = store.query_tables("tm1", None).await.expect("query tables");
    assert_eq!(tables.len(), 2);
    let named = store
        .query_tables("tm1", Some("metrics"))
        .await
        .expect("query named");
    assert_eq!(named.len(), 2);
    let by_id = store
        .get_table_by_id(id1)
        .await
        .expect("get table by id")
        .expect("found");
    assert_eq!(by_id.columns, vec!["a".to_string(), "b".to_string()]);

    // media
    let mid1 = store
        .insert_media(&MediaRow {
            id: None,
            run_id: "tm1".into(),
            step: 0,
            name: "img".into(),
            kind: "image".into(),
            ext: "png".into(),
            hash: "h1".into(),
            file_path: "media/tm1/img.png".into(),
            size: 10,
            created_at: 1000.0,
        })
        .await
        .expect("insert media1");
    let mid2 = store
        .insert_media(&MediaRow {
            id: None,
            run_id: "tm1".into(),
            step: 1,
            name: "vid".into(),
            kind: "video".into(),
            ext: "mp4".into(),
            hash: "h2".into(),
            file_path: "media/tm1/vid.mp4".into(),
            size: 20,
            created_at: 2000.0,
        })
        .await
        .expect("insert media2");
    assert_ne!(mid1, mid2);
    let media = store.query_media("tm1", None).await.expect("query media");
    assert_eq!(media.len(), 2);
    let imgs = store
        .query_media("tm1", Some("image"))
        .await
        .expect("query images");
    assert_eq!(imgs.len(), 1);
    assert_eq!(imgs[0].kind, "image");
    let by_id = store
        .get_media_by_id(mid2)
        .await
        .expect("get media by id")
        .expect("found");
    assert_eq!(by_id.kind, "video");

    cleanup("tables_media");
}

#[tokio::test]
async fn file_storage_histograms() {
    let store = file_store("hist").await;

    let run = RunMeta {
        run_id: "h1".into(),
        project: "hp".into(),
        group_name: None,
        name: None,
        state: "running".into(),
        config: serde_json::json!({}),
        env: serde_json::json!({}),
        git_commit: None,
        sweep_id: None,
        created_at: 1000.0,
        heartbeat_at: None,
        tags: None,
        owner_id: Some(1),
    };
    store.upsert_run(&run).await.expect("upsert run");

    let hist = |step: i64| HistogramRow {
        run_id: "h1".into(),
        step,
        wall_time: 1000.0 + step as f64,
        key: "weight".into(),
        context: "layer0".into(),
        bucket_limits: vec![0.0, 1.0],
        bucket_counts: vec![5, 5],
        min: 0.0,
        max: 1.0,
        num: 10,
        sum: 5.0,
        sum_squares: 3.0,
    };
    store
        .insert_histograms(&[hist(0), hist(1)])
        .await
        .expect("insert hist");
    store
        .insert_histograms(&[HistogramRow {
            run_id: "h1".into(),
            step: 0,
            wall_time: 2000.0,
            key: "bias".into(),
            context: "layer1".into(),
            bucket_limits: vec![0.0, 0.5],
            bucket_counts: vec![2, 8],
            min: 0.0,
            max: 0.5,
            num: 10,
            sum: 3.0,
            sum_squares: 1.0,
        }])
        .await
        .expect("insert bias");

    let all = store
        .query_histograms("h1", None, None)
        .await
        .expect("query all");
    assert_eq!(all.len(), 3);
    let weight = store
        .query_histograms("h1", Some("weight"), None)
        .await
        .expect("query weight");
    assert_eq!(weight.len(), 2);
    let ctx = store
        .query_histograms("h1", Some("weight"), Some("layer0"))
        .await
        .expect("query ctx");
    assert_eq!(ctx.len(), 2);
    let none = store
        .query_histograms("h1", Some("nope"), None)
        .await
        .expect("query none");
    assert!(none.is_empty());

    store
        .delete_histograms_for_run("h1")
        .await
        .expect("delete hist");
    let empty = store
        .query_histograms("h1", None, None)
        .await
        .expect("query empty");
    assert!(empty.is_empty());

    cleanup("hist");
}

#[tokio::test]
async fn file_storage_users_tokens_shares() {
    let store = file_store("auth").await;

    // users
    let u1 = trailer_core::domain::UserRow {
        id: None,
        username: "alice".into(),
        password: "h1".into(),
        role: "experimenter".into(),
        created_at: 1000.0,
        theme: "{}".into(),
    };
    let id1 = store.insert_user(&u1).await.expect("insert alice");
    let u2 = trailer_core::domain::UserRow {
        id: None,
        username: "bob".into(),
        password: "h2".into(),
        role: "experimenter".into(),
        created_at: 1000.0,
        theme: "{}".into(),
    };
    let id2 = store.insert_user(&u2).await.expect("insert bob");
    assert_ne!(id1, id2);
    // 用户名唯一
    assert!(
        store.insert_user(&u1).await.is_err(),
        "duplicate username rejected"
    );

    assert_eq!(
        store
            .get_user_by_username("alice")
            .await
            .expect("get alice")
            .expect("found")
            .id,
        Some(id1)
    );
    assert_eq!(
        store
            .get_user_by_id(id2)
            .await
            .expect("get bob")
            .expect("found")
            .username,
        "bob"
    );
    assert_eq!(
        store
            .list_users(None, None)
            .await
            .expect("list users")
            .len(),
        2
    );

    store
        .update_user_role(id1, "admin")
        .await
        .expect("set role");
    assert_eq!(
        store
            .get_user_by_id(id1)
            .await
            .expect("get")
            .expect("found")
            .role,
        "admin"
    );
    store
        .update_user_password(id1, "newhash")
        .await
        .expect("set pw");
    assert_eq!(
        store
            .get_user_by_id(id1)
            .await
            .expect("get")
            .expect("found")
            .password,
        "newhash"
    );
    store.delete_user(id2).await.expect("delete bob");
    assert!(store.get_user_by_id(id2).await.expect("get").is_none());

    // api_tokens
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs_f64();
    store
        .create_api_token("rt_perm", id1, Some("ci"), None)
        .await
        .expect("create perm");
    store
        .create_api_token("rt_expired", id1, Some("old"), Some(now - 10.0))
        .await
        .expect("create expired");
    assert!(store
        .get_user_by_api_token("rt_perm")
        .await
        .expect("auth perm")
        .is_some());
    assert!(
        store
            .get_user_by_api_token("rt_expired")
            .await
            .expect("auth expired")
            .is_none(),
        "expired rejected"
    );
    let tokens = store.list_api_tokens(id1).await.expect("list tokens");
    assert_eq!(tokens.len(), 2);
    store
        .delete_api_token("rt_expired")
        .await
        .expect("delete token");
    assert!(store
        .get_user_by_api_token("rt_expired")
        .await
        .expect("auth deleted")
        .is_none());

    // shares
    store
        .create_share("st1", "run", "r1", None)
        .await
        .expect("create share");
    store
        .create_share("st2", "run", "r2", Some(now + 100.0))
        .await
        .expect("create share2");
    let got = store
        .get_share("st1")
        .await
        .expect("get share")
        .expect("found");
    assert_eq!(got.0, "run");
    assert_eq!(
        store
            .list_shares(None, None)
            .await
            .expect("list shares")
            .len(),
        2
    );
    store
        .update_share_expiry("st2", Some(now - 5.0))
        .await
        .expect("update expiry");
    assert_eq!(
        store.delete_expired_shares().await.expect("delete expired"),
        1
    );
    assert!(store.get_share("st2").await.expect("get").is_none());
    store.delete_share("st1").await.expect("delete share");
    assert!(store
        .list_shares(None, None)
        .await
        .expect("list")
        .is_empty());

    cleanup("auth");
}

#[tokio::test]
async fn file_storage_reports_and_delete_project() {
    let store = file_store("reports").await;

    let run1 = RunMeta {
        run_id: "rp1".into(),
        project: "rpp".into(),
        group_name: None,
        name: None,
        state: "running".into(),
        config: serde_json::json!({}),
        env: serde_json::json!({}),
        git_commit: None,
        sweep_id: None,
        created_at: 1000.0,
        heartbeat_at: None,
        tags: None,
        owner_id: Some(1),
    };
    let run2 = RunMeta {
        run_id: "rp2".into(),
        project: "rpp2".into(),
        group_name: None,
        name: None,
        state: "running".into(),
        config: serde_json::json!({}),
        env: serde_json::json!({}),
        git_commit: None,
        sweep_id: None,
        created_at: 1000.0,
        heartbeat_at: None,
        tags: None,
        owner_id: Some(1),
    };
    store.upsert_run(&run1).await.expect("upsert rp1");
    store.upsert_run(&run2).await.expect("upsert rp2");

    // reports CRUD
    let rid1 = store
        .insert_report(&ReportRow {
            id: None,
            owner_id: None,
            project: "rpp".into(),
            title: "t1".into(),
            body: "b1".into(),
            created_at: 1000.0,
        })
        .await
        .expect("insert r1");
    let rid2 = store
        .insert_report(&ReportRow {
            id: None,
            owner_id: None,
            project: "rpp".into(),
            title: "t2".into(),
            body: "b2".into(),
            created_at: 1000.0,
        })
        .await
        .expect("insert r2");
    assert_ne!(rid1, rid2);
    assert_eq!(
        store
            .list_reports(Some("rpp"), None, None)
            .await
            .expect("list proj")
            .len(),
        2
    );
    assert_eq!(
        store
            .list_reports(Some("other"), None, None)
            .await
            .expect("list other")
            .len(),
        0
    );
    assert_eq!(
        store
            .get_report(&rid1)
            .await
            .expect("get")
            .expect("found")
            .title,
        "t1"
    );
    store
        .update_report(&rid1, "t1x", "b1x")
        .await
        .expect("update");
    assert_eq!(
        store
            .get_report(&rid1)
            .await
            .expect("get")
            .expect("found")
            .title,
        "t1x"
    );
    store.delete_report(&rid2).await.expect("delete report");
    assert!(store.get_report(&rid2).await.expect("get").is_none());

    // delete_runs_by_project
    let count = store
        .delete_runs_by_project("rpp")
        .await
        .expect("delete project");
    assert_eq!(count, 1, "deleted rp1");
    assert!(store.get_run("rp1").await.expect("get rp1").is_none());
    assert!(
        store.get_run("rp2").await.expect("get rp2").is_some(),
        "other project unaffected"
    );
    assert!(
        store
            .list_reports(Some("rpp"), None, None)
            .await
            .expect("list after")
            .is_empty(),
        "project reports cleaned"
    );

    cleanup("reports");
}

/// 文件模式跑完整 contract(与 SQLite 同一套断言)。
#[tokio::test]
async fn file_full_contract() {
    let store = file_store("full").await;
    run_contract_tests(store).await;
    cleanup("full");
}

// ─── Shared test logic ───
async fn run_contract_tests(store: Arc<dyn Storage>) {
    // 1. Create a run
    let run = RunMeta {
        run_id: "test-run-1".into(),
        project: "test".into(),
        group_name: None,
        name: Some("integration test".into()),
        state: "running".into(),
        config: serde_json::json!({"lr": 0.001}),
        env: serde_json::json!({"gpu": "A100"}),
        git_commit: None,
        sweep_id: None,
        created_at: 1000.0,
        heartbeat_at: None,
        tags: None,
        owner_id: None,
    };
    store.upsert_run(&run).await.expect("upsert_run");

    // 2. Insert + query metrics
    let metrics: Vec<MetricRow> = (0..10)
        .map(|i| MetricRow {
            run_id: "test-run-1".into(),
            step: i,
            wall_time: 1000.0 + i as f64,
            key: "loss".into(),
            context: "train".into(),
            value: 1.0 / (i as f64 + 1.0),
        })
        .collect();
    store
        .insert_metrics(&metrics)
        .await
        .expect("insert_metrics");

    let q = MetricQuery {
        run_id: Some("test-run-1".into()),
        key: Some("loss".into()),
        context: Some("train".into()),
        ..Default::default()
    };
    let result = store.query_metrics(&q).await.expect("query_metrics");
    assert_eq!(result.len(), 10);
    assert_eq!(result[0].step, 0);
    assert_eq!(result[9].step, 9);

    // 3. List + Get + Heartbeat
    let runs = store
        .list_runs(&RunFilter {
            project: Some("test".into()),
            ..Default::default()
        })
        .await
        .expect("list_runs");
    assert_eq!(runs.len(), 1);
    let found = store.get_run("test-run-1").await.expect("get_run");
    assert!(found.is_some());
    store
        .heartbeat("test-run-1", 2000.0)
        .await
        .expect("heartbeat");

    // 3b. Sweep_id 过滤
    let sweep_run = RunMeta {
        run_id: "test-sweep-1".into(),
        project: "test".into(),
        group_name: None,
        name: Some("sweep member".into()),
        state: "finished".into(),
        config: serde_json::json!({"lr": 0.01}),
        env: serde_json::json!({}),
        git_commit: None,
        sweep_id: Some("sweep-a".into()),
        created_at: 3000.0,
        heartbeat_at: None,
        tags: None,
        owner_id: None,
    };
    store
        .upsert_run(&sweep_run)
        .await
        .expect("upsert sweep run");
    let in_sweep = store
        .list_runs(&RunFilter {
            sweep_id: Some("sweep-a".into()),
            ..Default::default()
        })
        .await
        .expect("list by sweep_id");
    assert_eq!(
        in_sweep.len(),
        1,
        "sweep filter should return the sweep member"
    );
    assert_eq!(in_sweep[0].run_id, "test-sweep-1");
    let missing = store
        .list_runs(&RunFilter {
            sweep_id: Some("nope".into()),
            ..Default::default()
        })
        .await
        .expect("list by missing sweep");
    assert!(missing.is_empty(), "unknown sweep_id should return empty");

    // 4. get_max_step
    let max = store
        .get_max_step("test-run-1")
        .await
        .expect("get_max_step");
    assert_eq!(max, Some(9));

    // 4b. Summary upsert + get
    let summaries = vec![SummaryRow {
        run_id: "test-run-1".into(),
        key: "loss".into(),
        context: "train".into(),
        last: Some(0.5),
        best: Some(0.1),
        best_step: Some(3),
        min_val: Some(0.1),
        max_val: Some(0.9),
        user_val: None,
    }];
    store
        .upsert_summary(&summaries)
        .await
        .expect("upsert summary");
    let got = store
        .get_summary(&["test-run-1".into()])
        .await
        .expect("get summary");
    assert_eq!(got.len(), 1);
    assert_eq!(got[0].key, "loss");
    assert_eq!(got[0].last, Some(0.5));
    // 覆写验证 upsert
    store
        .upsert_summary(&[SummaryRow {
            run_id: "test-run-1".into(),
            key: "loss".into(),
            context: "train".into(),
            last: Some(0.6),
            best: Some(0.1),
            best_step: Some(3),
            min_val: Some(0.1),
            max_val: Some(0.9),
            user_val: None,
        }])
        .await
        .expect("re-upsert summary");
    let got = store
        .get_summary(&["test-run-1".into()])
        .await
        .expect("get summary2");
    assert_eq!(got.len(), 1);
    assert_eq!(got[0].last, Some(0.6));

    // 5. Texts
    let texts = vec![
        TextRow {
            run_id: "test-run-1".into(),
            step: 0,
            name: "log".into(),
            body: "epoch 0".into(),
        },
        TextRow {
            run_id: "test-run-1".into(),
            step: 1,
            name: "log".into(),
            body: "epoch 1".into(),
        },
    ];
    store.insert_texts(&texts).await.expect("insert_texts");
    let got = store
        .query_texts("test-run-1", "log", None)
        .await
        .expect("query_texts");
    assert_eq!(got.len(), 2);
    assert_eq!(got[0].body, "epoch 0");

    // 6. Figures
    let fig = FigureRow {
        run_id: "test-run-1".into(),
        step: 0,
        name: "curve".into(),
        kind: "png".into(),
        body: "data".into(),
    };
    store.insert_figure(&fig).await.expect("insert_figure");
    let g2 = FigureRow {
        run_id: "test-run-1".into(),
        step: 1,
        name: "spec".into(),
        kind: "g2".into(),
        body: "{}".into(),
    };
    store.insert_figure(&g2).await.expect("insert_figure g2");
    let figs = store
        .query_figures("test-run-1", None)
        .await
        .expect("query_figures");
    assert_eq!(figs.len(), 2);
    let named = store
        .query_figures("test-run-1", Some("curve"))
        .await
        .expect("query_figures by name");
    assert_eq!(named.len(), 1);

    // 7. Tables
    let table = TableRow {
        id: None,
        run_id: "test-run-1".into(),
        step: 0,
        name: "results".into(),
        columns: vec!["epoch".into(), "loss".into()],
        data: serde_json::json!([[0, 0.5], [1, 0.3]]),
        row_count: 2,
        created_at: 1000.0,
    };
    let tid = store.insert_table(&table).await.expect("insert_table");
    assert!(tid > 0);
    let tables = store
        .query_tables("test-run-1", None)
        .await
        .expect("query_tables");
    assert_eq!(tables.len(), 1);
    let by_id = store.get_table_by_id(tid).await.expect("get_table_by_id");
    assert!(by_id.is_some());
    assert_eq!(by_id.unwrap().row_count, 2);

    // 8. Media
    let media = MediaRow {
        id: None,
        run_id: "test-run-1".into(),
        step: 0,
        name: "img".into(),
        kind: "image".into(),
        ext: "png".into(),
        hash: "abc".into(),
        file_path: "img.png".into(),
        size: 100,
        created_at: 1000.0,
    };
    let mid = store.insert_media(&media).await.expect("insert_media");
    assert!(mid > 0);
    let all_media = store
        .query_media("test-run-1", None)
        .await
        .expect("query_media");
    assert_eq!(all_media.len(), 1);
    let by_mid = store.get_media_by_id(mid).await.expect("get_media_by_id");
    assert!(by_mid.is_some());
    assert_eq!(by_mid.unwrap().kind, "image");

    // 9. Reports
    let report = ReportRow {
        id: None,
        owner_id: None,
        project: "test".into(),
        title: "Summary".into(),
        body: "# Results".into(),
        created_at: 1000.0,
    };
    let rid = store.insert_report(&report).await.expect("insert_report");
    assert!(rid.starts_with("report_"));
    let reports = store
        .list_reports(Some("test"), None, None)
        .await
        .expect("list_reports");
    assert_eq!(reports.len(), 1);
    let by_rid = store.get_report(&rid).await.expect("get_report");
    assert!(by_rid.is_some());
    assert_eq!(by_rid.unwrap().title, "Summary");

    // 10. Histograms
    let histograms: Vec<HistogramRow> = (0..5)
        .map(|i| HistogramRow {
            run_id: "test-run-1".into(),
            step: i,
            wall_time: 1000.0 + i as f64,
            key: "weights".into(),
            context: "layer1".into(),
            bucket_limits: vec![-1.0, -0.5, 0.0, 0.5, 1.0],
            bucket_counts: vec![1, 3, 5, 2, 0],
            min: -0.8,
            max: 0.9,
            num: 11,
            sum: 0.5,
            sum_squares: 0.75,
        })
        .collect();
    store
        .insert_histograms(&histograms)
        .await
        .expect("insert_histograms");

    let hq = store
        .query_histograms("test-run-1", Some("weights"), Some("layer1"))
        .await
        .expect("query_histograms");
    assert_eq!(hq.len(), 5);
    assert_eq!(hq[0].step, 0);
    assert_eq!(hq[0].bucket_limits.len(), 5);
    assert_eq!(hq[0].bucket_counts.len(), 5);

    // Histogram delete
    store
        .delete_histograms_for_run("test-run-1")
        .await
        .expect("delete_histograms_for_run");
    let empty_hq = store
        .query_histograms("test-run-1", None, None)
        .await
        .expect("query_histograms after delete");
    assert!(empty_hq.is_empty());

    // 11. Summary
    // (summary methods are used in the tap, test basic read)
    let _empty = store
        .get_summary(&["test-run-1".into()])
        .await
        .expect("get_summary");
    // may be empty since we didn't go through the tap pipeline

    // 12. Owner isolation (无共享:experimenter 只见自己拥有的 run)
    let run_u1 = RunMeta {
        run_id: "own-u1".into(),
        project: "p1".into(),
        group_name: None,
        name: None,
        state: "running".into(),
        config: serde_json::json!({}),
        env: serde_json::json!({}),
        git_commit: None,
        sweep_id: None,
        created_at: 1100.0,
        heartbeat_at: None,
        tags: None,
        owner_id: Some(1),
    };
    let run_u2 = RunMeta {
        run_id: "own-u2".into(),
        project: "p2".into(),
        group_name: None,
        name: None,
        state: "running".into(),
        config: serde_json::json!({}),
        env: serde_json::json!({}),
        git_commit: None,
        sweep_id: None,
        created_at: 1200.0,
        heartbeat_at: None,
        tags: None,
        owner_id: Some(2),
    };
    store.upsert_run(&run_u1).await.expect("upsert u1");
    store.upsert_run(&run_u2).await.expect("upsert u2");

    // 默认(owner_id=None)看全部
    let all = store
        .list_runs(&RunFilter {
            ..Default::default()
        })
        .await
        .expect("list all");
    assert!(all.len() >= 2, "expected at least the 2 owned runs");

    // owner 过滤:user1 只看自己的 run
    let mine = store
        .list_runs(&RunFilter {
            owner_id: Some(1),
            ..Default::default()
        })
        .await
        .expect("list u1");
    assert!(!mine.is_empty());
    assert!(
        mine.iter().all(|r| r.owner_id == Some(1)),
        "u1 sees only own runs"
    );
    // user1 看不到 user2 的 run
    assert!(
        !mine.iter().any(|r| r.run_id == "own-u2"),
        "u1 cannot see others' runs"
    );

    // user2 只能看到自己的 run
    let u2_view = store
        .list_runs(&RunFilter {
            owner_id: Some(2),
            ..Default::default()
        })
        .await
        .expect("list u2");
    assert!(
        u2_view.iter().all(|r| r.owner_id == Some(2)),
        "u2 sees only own runs"
    );

    // 项目 owner 由 runs 推导:p1 的第一个 run 的 owner 是 user1
    assert_eq!(
        store.get_project_owner("p1").await.expect("owner p1"),
        Some(1)
    );
    assert_eq!(
        store.get_project_owner("p2").await.expect("owner p2"),
        Some(2)
    );
    assert_eq!(
        store.get_project_owner("nope").await.expect("owner nope"),
        None
    );

    // 13. Share token CRUD
    store
        .create_share("tok1", "run", "r1", Some(9999.0))
        .await
        .expect("create share tok1");
    store
        .create_share("tok2", "run", "r2", None)
        .await
        .expect("create share tok2");

    // list
    let shares = store.list_shares(None, None).await.expect("list shares");
    assert!(shares.iter().any(|s| s.token == "tok1"
        && s.resource_type == "run"
        && s.resource_id == "r1"
        && s.expires_at == Some(9999.0)));
    assert!(
        shares
            .iter()
            .any(|s| s.token == "tok2" && s.expires_at.is_none()),
        "tok2 has no expiry"
    );

    // update expiry(改周期)
    store
        .update_share_expiry("tok2", Some(1234.0))
        .await
        .expect("update expiry");
    let shares = store
        .list_shares(None, None)
        .await
        .expect("list shares after update");
    assert!(shares
        .iter()
        .any(|s| s.token == "tok2" && s.expires_at == Some(1234.0)));

    // get_share 仍可用
    let got = store.get_share("tok1").await.expect("get share");
    assert!(got.is_some());

    // delete(撤销)
    store.delete_share("tok1").await.expect("delete share");
    let shares = store
        .list_shares(None, None)
        .await
        .expect("list shares after delete");
    assert!(!shares.iter().any(|s| s.token == "tok1"), "tok1 deleted");
    assert!(store
        .get_share("tok1")
        .await
        .expect("get deleted")
        .is_none());

    // 14. API tokens CRUD + 认证查询
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs_f64();
    // 插入一个用户作为 token 归属
    let tu = trailer_core::domain::UserRow {
        id: None,
        username: "token_user".into(),
        password: "pw".into(),
        role: "experimenter".into(),
        created_at: 0.0,
        theme: "{}".into(),
    };
    let tuid = store.insert_user(&tu).await.expect("insert token user");
    store
        .create_api_token("rt_perm", tuid, Some("login"), None)
        .await
        .expect("create perm token");
    store
        .create_api_token("rt_short", tuid, Some("ci"), Some(now + 100.0))
        .await
        .expect("create short token");
    store
        .create_api_token("rt_expired", tuid, Some("old"), Some(now - 10.0))
        .await
        .expect("create expired token");

    // list:只列出该用户
    let tokens = store.list_api_tokens(tuid).await.expect("list tokens");
    assert!(tokens
        .iter()
        .any(|t| t.token == "rt_perm" && t.expires_at.is_none()));
    assert!(tokens
        .iter()
        .any(|t| t.token == "rt_short" && t.name.as_deref() == Some("ci")));
    assert!(!tokens.iter().any(|t| t.user_id != tuid));

    // get_user_by_api_token:永久/有效 → Some;过期 → None;不存在 → None
    let u = store
        .get_user_by_api_token("rt_perm")
        .await
        .expect("auth perm")
        .expect("perm valid");
    assert_eq!(u.username, "token_user");
    assert!(store
        .get_user_by_api_token("rt_short")
        .await
        .expect("auth short")
        .is_some());
    assert!(
        store
            .get_user_by_api_token("rt_expired")
            .await
            .expect("auth expired")
            .is_none(),
        "expired rejected"
    );
    assert!(store
        .get_user_by_api_token("rt_nope")
        .await
        .expect("auth nope")
        .is_none());

    // update expiry:rt_perm 永久 → 设 1 天后
    store
        .update_api_token_expiry("rt_perm", Some(now + 86400.0))
        .await
        .expect("update expiry");
    assert!(store
        .get_user_by_api_token("rt_perm")
        .await
        .expect("auth after update")
        .is_some());

    // delete:删除后认证失败
    store
        .delete_api_token("rt_perm")
        .await
        .expect("delete token");
    assert!(store
        .get_user_by_api_token("rt_perm")
        .await
        .expect("auth deleted")
        .is_none());

    // ── Explore CRUD ──
    let exp = ExploreRow {
        id: None,
        owner_id: 1,
        project: "test".into(),
        title: "scaling law".into(),
        description: "log-log".into(),
        run_ids: "[\"r1\"]".into(),
        chart_defs: "[{\"type\":\"line\"}]".into(),
        config: "{}".into(),
        created_at: 1000.0,
        updated_at: 1000.0,
    };
    let eid = store.insert_explore(&exp).await.expect("insert explore");
    assert!(eid.starts_with("explore_"));
    let got = store.get_explore(&eid).await.expect("get explore").unwrap();
    assert_eq!(got.title, "scaling law");
    assert_eq!(got.run_ids, "[\"r1\"]");
    assert_eq!(got.owner_id, 1);

    // 按 owner 隔离:owner 2 看不到,owner 0(admin)看全部
    let mine = store
        .list_explores(1, None, None, None)
        .await
        .expect("list owner 1");
    assert_eq!(mine.len(), 1);
    assert!(store
        .list_explores(2, None, None, None)
        .await
        .expect("list owner 2")
        .is_empty());
    assert!(
        store
            .list_explores(0, None, None, None)
            .await
            .expect("list all")
            .len()
            >= 1
    );

    // 按 project 过滤
    assert_eq!(
        store
            .list_explores(0, Some("test"), None, None)
            .await
            .expect("list by project")
            .len(),
        1
    );
    assert!(store
        .list_explores(0, Some("nope"), None, None)
        .await
        .expect("list missing project")
        .is_empty());

    // update
    store
        .update_explore(
            &eid,
            "scaling v2",
            "desc2",
            "[\"r1\",\"r2\"]",
            "[{\"type\":\"scatter\"}]",
            "{}",
        )
        .await
        .expect("update explore");
    let got = store
        .get_explore(&eid)
        .await
        .expect("get explore2")
        .unwrap();
    assert_eq!(got.title, "scaling v2");
    assert_eq!(got.run_ids, "[\"r1\",\"r2\"]");

    // delete
    store.delete_explore(&eid).await.expect("delete explore");
    assert!(store
        .get_explore(&eid)
        .await
        .expect("get explore3")
        .is_none());
}

// ─── PostgreSQL contract (runs when --features pg is enabled) ───
#[cfg(feature = "pg")]
#[tokio::test]
async fn pg_insert_and_query_metrics() {
    let url = std::env::var("TRAILER_PG_URL")
        .unwrap_or_else(|_| "postgres://trailer:trailer@127.0.0.1:5432/trailer_test".into());

    // Clean state: drop all tables
    let pgpool = sqlx::PgPool::connect(&url).await.expect("PG connect");
    let _ = sqlx::query("DROP TABLE IF EXISTS metrics, runs, run_summary, artifacts, figures, texts, tables, media, reports, histograms, shares, api_tokens, trailer_users, explores CASCADE")
        .execute(&pgpool)
        .await;
    pgpool.close().await;

    let store = trailer_core::storage::new_pg_storage(&url)
        .await
        .expect("failed to open PG");

    run_contract_tests(store).await;
}

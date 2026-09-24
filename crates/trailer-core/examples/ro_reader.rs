//! E3 实验用:Rust(bundled SQLite 3.46)只读轮询器。
//! 用法:cargo run -q -p trailer-core --example ro_reader -- <db> [--interval-ms 50]
//! 读到错误时把错误原文打到 stderr 并以非 0 退出;正常结束(Ctrl-C/超时由调用方控制)退出 0。

use std::str::FromStr;
use std::time::{Duration, Instant};
use sqlx::Row;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut args = std::env::args().skip(1);
    let db = args.next().expect("usage: ro_reader <db> [--interval-ms 50]");
    let mut interval_ms = 50u64;
    let mut it = args;
    while let Some(a) = it.next() {
        if a == "--interval-ms" {
            interval_ms = it.next().and_then(|v| v.parse().ok()).unwrap_or(50);
        }
    }

    let opts = sqlx::sqlite::SqliteConnectOptions::from_str(&db)?
        .read_only(true)
        .journal_mode(sqlx::sqlite::SqliteJournalMode::Wal);
    let pool = sqlx::sqlite::SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(opts)
        .await?;

    let start = Instant::now();
    let mut polls = 0u64;
    loop {
        polls += 1;
        match sqlx::query("SELECT count(*) FROM metrics").fetch_one(&pool).await {
            Ok(row) => {
                let n: i64 = row.try_get(0)?;
                if polls % 100 == 0 {
                    println!("polls={polls} metrics={n} elapsed={}s", start.elapsed().as_secs());
                }
            }
            Err(e) => {
                eprintln!("POLL_ERROR at polls={polls}: {e}");
                let check = sqlx::query("PRAGMA integrity_check").fetch_all(&pool).await;
                match check {
                    Ok(rows) => {
                        for r in rows {
                            let m: String = r.try_get(0)?;
                            eprintln!("integrity: {m}");
                        }
                    }
                    Err(e) => eprintln!("integrity_check also failed: {e}"),
                }
                pool.close().await;
                std::process::exit(3); // REPRO
            }
        }
        tokio::time::sleep(Duration::from_millis(interval_ms)).await;
    }
}

// RED: This test requires PG running — will FAIL until docker compose up pg
// After confirming failure, run `make pg-up` and retry for GREEN.

use sqlx::PgPool;

#[tokio::test]
async fn pg_connectivity_smoke_test() {
    let url = std::env::var("TRAILER_PG_URL")
        .unwrap_or_else(|_| "postgres://trailer:trailer@127.0.0.1:5432/trailer_test".into());

    let pool = PgPool::connect(&url)
        .await
        .expect("Failed to connect to PG — is `make pg-up` running?");

    let result: (i32,) = sqlx::query_as("SELECT 1").fetch_one(&pool).await.unwrap();

    assert_eq!(result.0, 1, "PG connectivity verified");

    pool.close().await;
}

/// Integration test: verify ts-rs type derivation compiles
/// and that exported types can be read by the frontend.
use trailer_core::domain::{Envelope, MetricRow};
use ts_rs::TS;

#[test]
fn metric_row_exports_ts_type() {
    // Verify the type name and that fields are exported
    let ts = MetricRow::decl();
    assert!(
        ts.contains("run_id"),
        "MetricRow should export run_id field"
    );
    assert!(ts.contains("step"), "MetricRow should export step field");
    assert!(ts.contains("key"), "MetricRow should export key field");
    assert!(ts.contains("value"), "MetricRow should export value field");
}

#[test]
fn envelope_exports_ts_type() {
    let ts = Envelope::decl();
    assert!(ts.contains("kind"), "Envelope should export kind field");
    assert!(ts.contains("run_id"), "Envelope should export run_id field");
}

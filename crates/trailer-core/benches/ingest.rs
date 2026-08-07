use criterion::{black_box, criterion_group, criterion_main, Criterion};
use std::collections::HashMap;
use trailer_core::domain::Envelope;

fn build_envelope(key_count: usize) -> Envelope {
    let mut payload = HashMap::new();
    for i in 0..key_count {
        payload.insert(
            format!("train/metric_{}", i),
            serde_json::json!((i as f64) * 0.1),
        );
    }
    Envelope {
        kind: "metric".into(),
        run_id: "bench-run".into(),
        step: 42,
        wall_time: 1234.5,
        context: String::new(),
        payload,
    }
}

fn bench_parse_key_simple(c: &mut Criterion) {
    c.bench_function("parse_key_context/simple", |b| {
        b.iter(|| trailer_core::ingest::parse_key_context(black_box("loss")))
    });
}

fn bench_parse_key_prefixed(c: &mut Criterion) {
    c.bench_function("parse_key_context/prefixed", |b| {
        b.iter(|| trailer_core::ingest::parse_key_context(black_box("train/loss")))
    });
}

fn bench_parse_key_multi(c: &mut Criterion) {
    c.bench_function("parse_key_context/multi_level", |b| {
        b.iter(|| trailer_core::ingest::parse_key_context(black_box("a/b/c/d/loss")))
    });
}

fn bench_envelope_to_metrics_1key(c: &mut Criterion) {
    let env = build_envelope(1);
    c.bench_function("envelope_to_metrics/1_key", |b| {
        b.iter(|| trailer_core::ingest::envelope_to_metrics(black_box(&env)))
    });
}

fn bench_envelope_to_metrics_5key(c: &mut Criterion) {
    let env = build_envelope(5);
    c.bench_function("envelope_to_metrics/5_keys", |b| {
        b.iter(|| trailer_core::ingest::envelope_to_metrics(black_box(&env)))
    });
}

fn bench_envelope_to_metrics_20key(c: &mut Criterion) {
    let env = build_envelope(20);
    c.bench_function("envelope_to_metrics/20_keys", |b| {
        b.iter(|| trailer_core::ingest::envelope_to_metrics(black_box(&env)))
    });
}

fn bench_msgpack_roundtrip(c: &mut Criterion) {
    let env = build_envelope(10);
    let bytes = rmp_serde::to_vec(&env).unwrap();
    c.bench_function("msgpack/encode", |b| {
        b.iter(|| rmp_serde::to_vec(black_box(&env)))
    });
    c.bench_function("msgpack/decode", |b| {
        b.iter(|| {
            let decoded: Envelope = rmp_serde::from_slice(black_box(&bytes)).unwrap();
            black_box(decoded)
        })
    });
}

criterion_group!(
    name = ingest;
    config = Criterion::default().sample_size(100);
    targets = bench_parse_key_simple, bench_parse_key_prefixed, bench_parse_key_multi,
              bench_envelope_to_metrics_1key, bench_envelope_to_metrics_5key,
              bench_envelope_to_metrics_20key, bench_msgpack_roundtrip
);
criterion_main!(ingest);

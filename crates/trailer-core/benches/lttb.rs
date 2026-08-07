use criterion::{black_box, criterion_group, criterion_main, Criterion};

/// Generate a sine wave dataset of `n` points.
fn sine_data(n: usize) -> Vec<(f64, f64)> {
    (0..n)
        .map(|i| {
            let x = i as f64;
            let y = (x * 0.01).sin() + (x * 0.003).cos() * 0.5;
            (x, y)
        })
        .collect()
}

fn bench_lttb_small(c: &mut Criterion) {
    let data = sine_data(1_000);
    c.bench_function("lttb/1k→100", |b| {
        b.iter(|| trailer_core::downsample::lttb(black_box(&data), black_box(100)))
    });
}

fn bench_lttb_medium(c: &mut Criterion) {
    let data = sine_data(100_000);
    c.bench_function("lttb/100k→1k", |b| {
        b.iter(|| trailer_core::downsample::lttb(black_box(&data), black_box(1_000)))
    });
}

fn bench_lttb_large(c: &mut Criterion) {
    let data = sine_data(1_000_000);
    c.bench_function("lttb/1M→10k", |b| {
        b.iter(|| trailer_core::downsample::lttb(black_box(&data), black_box(10_000)))
    });
}

fn bench_lttb_constant(c: &mut Criterion) {
    // Edge case: constant signal
    let data: Vec<(f64, f64)> = (0..100_000).map(|i| (i as f64, 42.0)).collect();
    c.bench_function("lttb/constant_100k→1k", |b| {
        b.iter(|| trailer_core::downsample::lttb(black_box(&data), black_box(1_000)))
    });
}

fn bench_lttb_spike(c: &mut Criterion) {
    // Edge case: single spike
    let mut data = vec![(0.0, 0.0); 100_000];
    data[50_000] = (50_000.0, 100.0);
    c.bench_function("lttb/spike_100k→1k", |b| {
        b.iter(|| trailer_core::downsample::lttb(black_box(&data), black_box(1_000)))
    });
}

criterion_group!(
    name = lttb;
    config = Criterion::default().sample_size(100).confidence_level(0.95);
    targets = bench_lttb_small, bench_lttb_medium, bench_lttb_large,
              bench_lttb_constant, bench_lttb_spike
);
criterion_main!(lttb);

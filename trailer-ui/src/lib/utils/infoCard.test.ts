import { describe, it, expect } from 'vitest';
import {
  formatElapsed,
  formatMoney,
  formatDelta,
  metricDelta,
  statusFromRunState,
  modelNameFromConfig,
  trainingSeconds,
  flattenConfigKeys,
  resolveConfigValue,
  formatCell,
  type InfoCellInput,
} from './infoCard';

describe('formatElapsed', () => {
  it('formats as HH:MM:SS under a day', () => {
    expect(formatElapsed(0)).toBe('00:00:00');
    expect(formatElapsed(3661)).toBe('01:01:01');
  });

  it('prefixes days beyond 24h', () => {
    expect(formatElapsed(90061)).toBe('1d 01:01:01');
    expect(formatElapsed(180000)).toBe('2d 02:00:00');
  });

  it('clamps negatives', () => {
    expect(formatElapsed(-5)).toBe('00:00:00');
  });
});

describe('formatMoney', () => {
  it('formats with thousands separators and $', () => {
    expect(formatMoney(1063883.42)).toBe('$1,063,883');
  });

  it('keeps decimals for small amounts', () => {
    expect(formatMoney(42.5)).toBe('$42.50');
    expect(formatMoney(0)).toBe('$0.00');
  });
});

describe('formatDelta / metricDelta', () => {
  it('computes delta vs first point', () => {
    const pts = [{ step: 1, value: 2.5, idx: 0 }, { step: 9, value: 0.615, idx: 1 }];
    expect(metricDelta(pts)).toBeCloseTo(-1.885, 6);
  });

  it('returns null with fewer than 2 points', () => {
    expect(metricDelta([{ step: 1, value: 2.5, idx: 0 }])).toBeNull();
  });

  it('formats up/down arrows', () => {
    expect(formatDelta(0.051)).toBe('▲0.051');
    expect(formatDelta(-0.051)).toBe('▼0.051');
  });

  it('hides zero delta', () => {
    expect(formatDelta(0)).toBeNull();
  });
});

describe('statusFromRunState', () => {
  it('maps run states to english status text', () => {
    expect(statusFromRunState('running')).toBe('in progress');
    expect(statusFromRunState('finished')).toBe('finished');
    expect(statusFromRunState('crashed')).toBe('crashed');
    expect(statusFromRunState('killed')).toBe('killed');
    expect(statusFromRunState('')).toBe('');
  });
});

describe('modelNameFromConfig', () => {
  it('prefers explicit path, then common keys', () => {
    expect(modelNameFromConfig({ model_name: 'gpt' }, undefined)).toBe('gpt');
    expect(modelNameFromConfig({ model: 'resnet50' }, undefined)).toBe('resnet50');
    expect(modelNameFromConfig({ model: { path: 'org/resnet' } }, 'model.path')).toBe('org/resnet');
  });

  it('returns undefined when nothing matches', () => {
    expect(modelNameFromConfig({ lr: 1 }, undefined)).toBeUndefined();
  });
});

describe('flattenConfigKeys', () => {
  it('flattens nested objects into dotted leaf paths', () => {
    const config = { train: { lr: 0.01, schedule: { warmup: 500 } }, model: 'resnet', flags: [1, 2] };
    expect(flattenConfigKeys(config)).toEqual(['flags', 'model', 'train.lr', 'train.schedule.warmup']);
  });

  it('skips empty objects and sorts output', () => {
    const config = { b: {}, a: 1 };
    expect(flattenConfigKeys(config)).toEqual(['a']);
  });
});

describe('resolveConfigValue', () => {
  const config = {
    train: { lr: 0.01, batch: 32, schedule: { warmup: 500 } },
    model: 'resnet50',
    flags: [1, 2, 3],
  };

  it('resolves dotted paths into nested objects', () => {
    expect(resolveConfigValue(config, 'train.lr')).toBe('0.01');
    expect(resolveConfigValue(config, 'train.schedule.warmup')).toBe('500');
    expect(resolveConfigValue(config, 'model')).toBe('resnet50');
  });

  it('returns undefined for missing paths', () => {
    expect(resolveConfigValue(config, 'train.missing')).toBeUndefined();
    expect(resolveConfigValue(config, 'nope.deeper')).toBeUndefined();
  });

  it('stringifies objects and arrays', () => {
    expect(resolveConfigValue(config, 'flags')).toBe('[1,2,3]');
    expect(resolveConfigValue(config, 'train.schedule')).toBe('{"warmup":500}');
  });

  it('stringifies primitives via String()', () => {
    expect(resolveConfigValue(config, 'train.batch')).toBe('32');
  });
});

describe('trainingSeconds', () => {
  const wallMetrics = [
    { key: 'loss', context: 'train', points: [
      { step: 1, value: 2.5, idx: 0, wall_time: 1000 },
      { step: 9, value: 0.615, idx: 1, wall_time: 4600 },
    ] },
  ];

  it('derives duration from metric wall_time span', () => {
    expect(trainingSeconds({ item: { src: 'cost' }, metrics: wallMetrics })).toBe(3600);
  });

  it('ignores now entirely when wall_time exists', () => {
    expect(trainingSeconds({ item: { src: 'cost' }, metrics: wallMetrics, now: 999_999_000, running: true })).toBe(3600);
  });

  it('spans across multiple series', () => {
    const two = [
      wallMetrics[0],
      { key: 'acc', context: 'eval', points: [{ step: 8, value: 0.9, idx: 0, wall_time: 8200 }] },
    ];
    expect(trainingSeconds({ item: { src: 'cost' }, metrics: two })).toBe(7200);
  });

  it('falls back to now/endAt when points lack wall_time', () => {
    const noWall = [{ key: 'loss', context: 'train', points: [{ step: 1, value: 1, idx: 0 }] }];
    expect(trainingSeconds({ item: { src: 'cost' }, metrics: noWall, createdAt: 0, now: 3600_000, running: true })).toBe(3600);
    expect(trainingSeconds({ item: { src: 'cost' }, metrics: noWall, createdAt: 0, endAt: 1800, running: false })).toBe(1800);
  });

  it('returns null with no data at all', () => {
    expect(trainingSeconds({ item: { src: 'cost' }, metrics: [] })).toBeNull();
  });
});

describe('formatCell', () => {
  const metrics = [
    { key: 'loss', context: 'train', points: [
      { step: 1, value: 2.5, idx: 0, wall_time: 1000 },
      { step: 9, value: 0.615, idx: 1, wall_time: 4600 },
    ] },
    { key: 'acc', context: 'eval', points: [{ step: 8, value: 0.9, idx: 0, wall_time: 4600 }] },
  ];

  const base: InfoCellInput = {
    item: { src: 'cost' },
    now: 1_000_000,
    createdAt: 0,
    endAt: undefined,
    gpus: 2,
    metrics,
  };

  it('renders metric cell with delta vs step 1', () => {
    const row = formatCell({ ...base, item: { src: 'metric', key: 'loss', context: 'train' } });
    expect(row.label).toBe('loss [train] · Δ vs step 1');
    expect(row.value).toBe('0.615');
    expect(row.delta).toBe('▼1.885');
    expect(row.deltaUp).toBe(false);
  });

  it('omits delta with fewer than 2 points', () => {
    const row = formatCell({ ...base, item: { src: 'metric', key: 'acc', context: 'eval' } });
    expect(row.value).toBe('0.9');
    expect(row.delta).toBeUndefined();
  });

  it('renders dash when metric series missing', () => {
    const row = formatCell({ ...base, item: { src: 'metric', key: 'gone', context: '' } });
    expect(row.value).toBe('—');
  });

  it('renders cost cell as money from wall_time span', () => {
    const row = formatCell({ ...base, item: { src: 'cost' }, metrics: base.metrics, unitPrice: 5, running: true });
    expect(row.label).toBe('cost so far');
    expect(row.value).toBe('$10.00');
  });

  it('renders cost cell as gpu-hours without price', () => {
    const row = formatCell({ ...base, item: { src: 'cost' }, running: true });
    expect(row.value).toBe('2.00 GPU·h');
  });

  it('renders config cells via resolveConfigValue', () => {
    const row = formatCell({
      ...base,
      item: { src: 'config', path: 'train.lr', label: 'lr' },
      config: { train: { lr: 0.01 } },
    });
    expect(row.value).toBe('0.01');
    expect(row.label).toBe('lr');
  });

  it('falls back label for config without label to its path', () => {
    const row = formatCell({ ...base, item: { src: 'config', path: 'train.lr' }, config: { train: { lr: 1 } } });
    expect(row.label).toBe('train.lr');
  });
});

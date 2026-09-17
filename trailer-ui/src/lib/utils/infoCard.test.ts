import { describe, it, expect } from 'vitest';
import {
  formatDuration,
  computeCost,
  resolveConfigValue,
  flattenConfigKeys,
  formatInfoValue,
  type InfoRowInput,
} from './infoCard';

describe('formatDuration', () => {
  it('formats zero as 0秒', () => {
    expect(formatDuration(0)).toBe('0秒');
  });

  it('formats plain seconds', () => {
    expect(formatDuration(59)).toBe('59秒');
  });

  it('omits leading zero units', () => {
    expect(formatDuration(60)).toBe('1分钟');
    expect(formatDuration(3600)).toBe('1小时');
    expect(formatDuration(86400)).toBe('1天');
  });

  it('formats mixed days/hours/minutes/seconds', () => {
    expect(formatDuration(90061)).toBe('1天1小时1分钟1秒');
    expect(formatDuration(5430)).toBe('1小时30分钟30秒');
  });

  it('ignores negative input', () => {
    expect(formatDuration(-5)).toBe('0秒');
  });
});

describe('computeCost', () => {
  it('computes gpu-hours from seconds and card count', () => {
    expect(computeCost({ seconds: 3600, gpus: 2 })).toEqual({ gpuHours: 2 });
  });

  it('handles fractional hours', () => {
    expect(computeCost({ seconds: 1800, gpus: 3 })).toEqual({ gpuHours: 1.5 });
  });

  it('applies unit price to amount', () => {
    expect(computeCost({ seconds: 3600, gpus: 2, unitPrice: 3 })).toEqual({ gpuHours: 2, amount: 6 });
  });

  it('rounds display to 2 decimals', () => {
    expect(computeCost({ seconds: 36, gpus: 1 })).toEqual({ gpuHours: 0.01 });
  });

  it('returns zero gpuHours without cards', () => {
    expect(computeCost({ seconds: 3600, gpus: 0 })).toEqual({ gpuHours: 0 });
    expect(computeCost({ seconds: 3600 })).toEqual({ gpuHours: 0 });
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
    expect(resolveConfigValue(config, 'model')).toBe('resnet50');
  });
});

describe('formatInfoValue', () => {
  const metrics = [
    { key: 'loss', context: 'train', points: [{ step: 1, value: 2.5, idx: 0 }, { step: 9, value: 0.123456789, idx: 1 }] },
    { key: 'acc', context: 'eval', points: [{ step: 8, value: 0.9, idx: 0 }] },
  ];

  const base: InfoRowInput = {
    item: { src: 'step' },
    now: 1_000_000,
    createdAt: 0,
    endAt: undefined,
    gpus: 2,
    metrics,
  };

  it('renders step as max step across series', () => {
    expect(formatInfoValue(base).value).toBe('9');
  });

  it('renders metric as last point value with label', () => {
    const row = formatInfoValue({
      ...base,
      item: { src: 'metric', key: 'loss', context: 'train' },
    });
    expect(row.value).toBe('0.123457');
    expect(row.label).toBe('loss [train]');
  });

  it('renders dash when metric series missing', () => {
    const row = formatInfoValue({ ...base, item: { src: 'metric', key: 'gone', context: '' } });
    expect(row.value).toBe('—');
  });

  it('renders running elapsed from createdAt to now', () => {
    const row = formatInfoValue({ ...base, item: { src: 'elapsed' }, running: true });
    expect(row.value).toBe(formatDuration((1_000_000 - 0) / 1000));
  });

  it('freezes elapsed for finished runs using endAt', () => {
    const row = formatInfoValue({ ...base, item: { src: 'elapsed' }, running: false, endAt: 3600 });
    expect(row.value).toBe('1小时');
  });

  it('renders cost with gpus and unit price', () => {
    const row = formatInfoValue({ ...base, item: { src: 'cost' }, running: true });
    expect(row.value).toContain('GPU·h');
    const priced = formatInfoValue({ ...base, item: { src: 'cost' }, unitPrice: 5, running: true });
    expect(priced.value).toContain('¥');
  });

  it('renders config values via resolveConfigValue', () => {
    const row = formatInfoValue({ ...base, item: { src: 'config', path: 'train.lr', label: '学习率' }, config: { train: { lr: 0.01 } } });
    expect(row.value).toBe('0.01');
    expect(row.label).toBe('学习率');
  });

  it('falls back label for config without label to its path', () => {
    const row = formatInfoValue({ ...base, item: { src: 'config', path: 'train.lr' }, config: { train: { lr: 1 } } });
    expect(row.label).toBe('train.lr');
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

import { describe, it, expect } from 'vitest';
import { metricId, groupMetricsByContext, filterMetrics, selectionState } from './metricGroups';

const opts = [
  { key: 'loss', context: 'train' },
  { key: 'acc', context: 'train' },
  { key: 'loss', context: 'test' },
  { key: 'cpu', context: 'system' },
  { key: 'gpu0', context: 'system/nvidia' },
  { key: 'lr', context: '' },
];

describe('metricId', () => {
  it('renders bare key for empty context', () => {
    expect(metricId({ key: 'loss', context: '' })).toBe('loss');
  });

  it('renders key[context] for non-empty context', () => {
    expect(metricId({ key: 'loss', context: 'train' })).toBe('loss[train]');
  });
});

describe('groupMetricsByContext', () => {
  it('puts root group first, then default order train/val/test/system, then alpha', () => {
    const groups = groupMetricsByContext(opts);
    expect(groups.map((g) => g.context)).toEqual(['', 'train', 'test', 'system']);
    expect(groups[0].label).toBe('root');
  });

  it('flattens multi-level context into first segment', () => {
    const groups = groupMetricsByContext(opts);
    const system = groups.find((g) => g.context === 'system')!;
    expect(system.items.map((i) => i.key).sort()).toEqual(['cpu', 'gpu0']);
  });

  it('sorts items within a group by key', () => {
    const groups = groupMetricsByContext(opts);
    const train = groups.find((g) => g.context === 'train')!;
    expect(train.items.map((i) => i.key)).toEqual(['acc', 'loss']);
  });

  it('honors explicit order option', () => {
    const groups = groupMetricsByContext(opts, { order: ['system', 'train'] });
    expect(groups.map((g) => g.context)).toEqual(['', 'system', 'train', 'test']);
  });

  it('honors rootLabel', () => {
    const groups = groupMetricsByContext(opts, { rootLabel: '默认' });
    expect(groups[0].label).toBe('默认');
  });

  it('preserves full context on items and count', () => {
    const withCount = [{ key: 'cpu', context: 'system', count: 42 }];
    const groups = groupMetricsByContext(withCount);
    expect(groups[0].items[0]).toEqual({ key: 'cpu', context: 'system', count: 42 });
  });
});

describe('filterMetrics', () => {
  it('matches key case-insensitively', () => {
    const r = filterMetrics(opts, 'LOSS');
    expect(r.map((i) => metricId(i)).sort()).toEqual(['loss[test]', 'loss[train]']);
  });

  it('matches context via combined form', () => {
    const r = filterMetrics(opts, 'train');
    expect(r.map((i) => metricId(i)).sort()).toEqual(['acc[train]', 'loss[train]']);
  });

  it('requires every whitespace/comma token to match (AND)', () => {
    expect(filterMetrics(opts, 'loss cpu')).toEqual([]);
    expect(filterMetrics(opts, 'system cpu').length).toBe(1);
  });

  it('returns all options for empty/blank query', () => {
    expect(filterMetrics(opts, '')).toEqual(opts);
    expect(filterMetrics(opts, '   ')).toEqual(opts);
  });
});

describe('selectionState', () => {
  const items = [
    { key: 'loss', context: 'train' },
    { key: 'acc', context: 'train' },
  ];

  it('all selected', () => {
    expect(selectionState(items, new Set(['loss[train]', 'acc[train]']))).toEqual({
      all: true,
      some: false,
      none: false,
    });
  });

  it('none selected', () => {
    expect(selectionState(items, new Set())).toEqual({ all: false, some: false, none: true });
  });

  it('some selected', () => {
    expect(selectionState(items, new Set(['loss[train]']))).toEqual({
      all: false,
      some: true,
      none: false,
    });
  });

  it('empty items is none', () => {
    expect(selectionState([], new Set())).toEqual({ all: false, some: false, none: true });
  });
});

import { describe, it, expect } from 'vitest';
import { metricId, groupMetricsByContext, buildPathTree, filterMetrics, selectionState } from './metricGroups';

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

describe('buildPathTree', () => {
  // 层级树:多段 context 逐级成目录,key 为叶子 —— groupMetricsByContext 的"首段压扁"只留给 optgroup 用
  const segs = (m: { key: string; context: string }) => (m.context ? m.context.split('/') : []);
  const build = (items: typeof opts, o?: { rootLabel?: string; order?: string[] }) =>
    buildPathTree(items, segs, (m) => m.key, o);

  it('splits multi-segment context into nested dirs with the key as leaf', () => {
    const tree = build([{ key: 'loss', context: 'train/s1_seq32k' }]);
    // train → s1_seq32k → loss(三层,不再是 train 下平铺)
    expect(tree).toHaveLength(1);
    expect(tree[0]).toMatchObject({ type: 'dir', path: 'train', label: 'train' });
    const s1 = tree[0].type === 'dir' ? tree[0].children[0] : null;
    expect(s1).toMatchObject({ type: 'dir', path: 'train/s1_seq32k', label: 's1_seq32k' });
    const leaf = s1 && s1.type === 'dir' ? s1.children[0] : null;
    expect(leaf).toMatchObject({ type: 'leaf', label: 'loss' });
  });

  it('puts empty-segment items into the rootLabel dir', () => {
    const tree = build([{ key: 'lr', context: '' }]);
    expect(tree).toHaveLength(1);
    expect(tree[0]).toMatchObject({ type: 'dir', label: 'root' });
    const leaf = tree[0].type === 'dir' ? tree[0].children[0] : null;
    expect(leaf).toMatchObject({ type: 'leaf', label: 'lr' });
  });

  it('sorts first segments root first, then order, then alpha', () => {
    const tree = build(opts); // root/train/test/system(与 groupMetricsByContext 同序)
    expect(tree.map((n) => (n.type === 'dir' ? n.label : n.label))).toEqual([
      'root', 'train', 'test', 'system',
    ]);
    const ordered = build(opts, { order: ['system', 'train'] });
    expect(ordered.map((n) => (n.type === 'dir' ? n.label : n.label))).toEqual([
      'root', 'system', 'train', 'test',
    ]);
  });

  it('sits dirs before leaves at the same level, each alpha', () => {
    const tree = build([
      { key: 'loss', context: 'train' },        // train 下直接叶子
      { key: 'b_loss', context: 'train/aux' },  // train 下子目录(aux 晚于字母序的叶子? dir 优先)
      { key: 'acc', context: 'train' },
    ]);
    const train = tree.find((n) => n.type === 'dir' && n.label === 'train')!;
    expect(train.type).toBe('dir');
    if (train.type !== 'dir') return;
    // 子目录 aux 在前,叶子按 key 字母序在后
    expect(train.children.map((c) => (c.type === 'dir' ? `dir:${c.label}` : `leaf:${c.label}`))).toEqual([
      'dir:aux', 'leaf:acc', 'leaf:loss',
    ]);
  });

  it('collects the whole subtree leaves into dir.items', () => {
    const tree = build(opts);
    const system = tree.find((n) => n.type === 'dir' && n.label === 'system')!;
    if (system.type !== 'dir') throw new Error('expected dir');
    // cpu(直接叶子)+ gpu0(nvidia 子目录)都算进 system 的子树
    expect(system.items.map((i) => i.key).sort()).toEqual(['cpu', 'gpu0']);
    const nvidia = system.children.find((c) => c.type === 'dir')!;
    if (nvidia.type !== 'dir') throw new Error('expected dir');
    expect(nvidia.items.map((i) => i.key)).toEqual(['gpu0']);
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

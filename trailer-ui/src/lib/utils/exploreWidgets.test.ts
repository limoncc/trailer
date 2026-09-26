import { describe, it, expect } from 'vitest';
import { computeConfigDiff, buildSummaryRows, formatStat, assignStableColors, colorValueOf, lineSeriesKey, lineSeriesKeys, runScopeKeys, colorKeysOf, PALETTE } from './exploreWidgets';
import type { RunRecord } from './explore';

function run(partial: Partial<RunRecord> & { run_id: string }): RunRecord {
  return {
    name: null,
    state: 'finished',
    project: 'p1',
    created_at: 1,
    sweep_id: null,
    config: {},
    summary: {},
    owner_id: null,
    ...partial,
  };
}

const runs: RunRecord[] = [
  run({
    run_id: 'r1',
    config: { params: 1e6, model: { depth: 12 }, name: 'gpt2', opt: 'adam', warmup: true },
    summary: {
      'loss/train': { last: 0.51234, best: 0.3, best_step: 10, min: 0.2, max: 1.0 },
      acc: { last: 0.9 },
    },
  }),
  run({
    run_id: 'r2',
    config: { params: 1e7, model: { depth: 12 } },
    summary: { 'loss/train': { last: 0.4, best: 0.35, best_step: 7, min: 0.3, max: 0.9 } },
  }),
  run({ run_id: 'r3', config: { params: 1e6, model: { depth: 24 } }, summary: {} }),
];

describe('computeConfigDiff', () => {
  it('keeps only differing leaves, sorted by path', () => {
    const diff = computeConfigDiff(runs.slice(0, 2));
    expect(diff.map((d) => d.path)).toEqual(['name', 'opt', 'params', 'warmup']);
  });

  it('holds one value per run, missing leaf rendered as (none)', () => {
    const diff = computeConfigDiff(runs.slice(0, 2));
    const params = diff.find((d) => d.path === 'params')!;
    expect(params.values).toEqual(['1000000', '10000000']);
    const name = diff.find((d) => d.path === 'name')!;
    expect(name.values).toEqual(['gpt2', '(none)']);
  });

  it('drops leaves whose values match across runs (nested config included)', () => {
    const diff = computeConfigDiff(runs.slice(0, 2));
    expect(diff.find((d) => d.path === 'model.depth')).toBeUndefined();
  });

  it('compares non-numeric leaves as strings', () => {
    const diff = computeConfigDiff(runs.slice(0, 2));
    expect(diff.find((d) => d.path === 'warmup')?.values).toEqual(['true', '(none)']);
  });

  it('returns an empty list for a single run', () => {
    expect(computeConfigDiff(runs.slice(0, 1))).toEqual([]);
  });

  it('returns an empty list when configs are identical', () => {
    const a = run({ run_id: 'a', config: { lr: 0.1 } });
    const b = run({ run_id: 'b', config: { lr: 0.1 } });
    expect(computeConfigDiff([a, b])).toEqual([]);
  });

  it('returns an empty list for no runs', () => {
    expect(computeConfigDiff([])).toEqual([]);
  });

  it('filters to the selected config paths (diff widget paths)', () => {
    const diff = computeConfigDiff(runs.slice(0, 2), ['params', 'name']);
    expect(diff.map((d) => d.path)).toEqual(['name', 'params']);
    // 未选中的 model.depth 被排除
    expect(diff.find((d) => d.path === 'model.depth')).toBeUndefined();
    // 选中但无差异的键也要出现(用户点名要看这一列;只有"空 paths=全部差异键"才筛差异)
    expect(computeConfigDiff(runs.slice(0, 2), ['model.depth']).map((d) => d.path)).toEqual(['model.depth']);
    expect(computeConfigDiff(runs.slice(0, 2), ['model.depth'])[0].values).toEqual(['12', '12']);
    // 空 paths = 对比全部差异键(缺省语义)
    expect(computeConfigDiff(runs.slice(0, 2), [])).toEqual(computeConfigDiff(runs.slice(0, 2)));
  });
});

describe('buildSummaryRows', () => {
  it('defaults metrics to the summary-key union, sorted', () => {
    const table = buildSummaryRows(runs.slice(0, 2));
    expect(table.metrics).toEqual([
      { key: 'acc', context: '' },
      { key: 'loss', context: 'train' },
    ]);
    expect(table.rows).toHaveLength(2);
  });

  it('aligns one cell per metric, missing stats stay undefined', () => {
    const table = buildSummaryRows(runs);
    expect(table.rows[0].runId).toBe('r1');
    expect(table.rows[0].cells[1]).toEqual({ last: 0.51234, best: 0.3, best_step: 10, min: 0.2, max: 1.0 });
    expect(table.rows[1].cells[0]).toBeUndefined();
    expect(table.rows[2].cells[1]).toBeUndefined();
  });

  it('honours an explicit metric list and order', () => {
    const table = buildSummaryRows(runs, [{ key: 'loss', context: 'train' }]);
    expect(table.metrics).toEqual([{ key: 'loss', context: 'train' }]);
    expect(table.rows[0].cells).toHaveLength(1);
  });

  it('keeps runs without summary as empty rows', () => {
    const table = buildSummaryRows([runs[2]]);
    expect(table.rows).toHaveLength(1);
    expect(table.rows[0].cells.every((c) => c === undefined)).toBe(true);
  });

  it('returns an empty table for no runs', () => {
    expect(buildSummaryRows([])).toEqual({ metrics: [], rows: [] });
  });
});

describe('formatStat', () => {
  it('renders missing values as an em dash', () => {
    expect(formatStat(undefined)).toBe('—');
  });

  it('formats numbers to 4 significant digits', () => {
    expect(formatStat(0.51234)).toBe('0.5123');
    expect(formatStat(1234.5)).toBe('1235');
  });
});

describe('assignStableColors', () => {
  it('assigns palette slots in first-seen order', () => {
    const map = assignStableColors(new Map(), ['r1', 'r2']);
    expect(map.get('r1')).toBe(PALETTE[0]);
    expect(map.get('r2')).toBe(PALETTE[1]);
  });

  it('keeps existing assignments when a run is appended', () => {
    const prev = assignStableColors(new Map(), ['r1', 'r2']);
    const next = assignStableColors(prev, ['r1', 'r2', 'r3']);
    expect(next.get('r1')).toBe(PALETTE[0]);
    expect(next.get('r2')).toBe(PALETTE[1]);
    expect(next.get('r3')).toBe(PALETTE[2]);
  });

  it('does not reshuffle when the input order changes or a run is hidden', () => {
    const prev = assignStableColors(new Map(), ['r1', 'r2', 'r3']);
    const hidden = assignStableColors(prev, ['r3', 'r1']);
    expect(hidden.get('r1')).toBe(PALETTE[0]);
    expect(hidden.get('r3')).toBe(PALETTE[2]);
    // 移除不清除:重新出现仍拿原色
    const back = assignStableColors(hidden, ['r1', 'r2', 'r3']);
    expect(back.get('r2')).toBe(PALETTE[1]);
  });

  it('wraps around the palette after 10 keys', () => {
    const keys = Array.from({ length: 12 }, (_, i) => `r${i}`);
    const map = assignStableColors(new Map(), keys);
    expect(map.get('r10')).toBe(PALETTE[0]);
    expect(map.get('r11')).toBe(PALETTE[1]);
  });

  it('never reassigns an already-mapped value even with new keys', () => {
    const prev = new Map([['custom', '#123456']]);
    const next = assignStableColors(prev, ['custom', 'r1']);
    expect(next.get('custom')).toBe('#123456');
    expect(next.get('r1')).toBe(PALETTE[1]);
  });
});

describe('assignStableColors — rebuild & collision skip', () => {
  it('rebuilding from scratch keeps surviving keys in the same slots (老键不换色)', () => {
    // Workspace.syncColors 的语义:以当前键集重建 —— 失效键不再占槽(避免 map 膨胀
    // 后 %10 回绕与新键撞色),存活键因插入序不变而保持原槽
    const first = assignStableColors(new Map(), ['r1', 'r2', 'r3']);
    expect(first.get('r1')).toBe(PALETTE[0]);
    expect(first.get('r3')).toBe(PALETTE[2]);
    // r2 被移除、r4 新增:重建后 r1/r3 槽不变,r4 拿到空出的槽
    const rebuilt = assignStableColors(new Map(), ['r1', 'r3', 'r4']);
    expect(rebuilt.get('r1')).toBe(PALETTE[0]);
    expect(rebuilt.get('r3')).toBe(PALETTE[1]); // r2 的槽被压缩,后续顺移 —— 与膨胀 map 的 %10 回绕不同
    expect(rebuilt.get('r4')).toBe(PALETTE[2]);
    expect(rebuilt.size).toBe(3); // 失效键 r2 已清,不再占位
  });

  it('skips an already-taken colour when %10 lands on a used slot', () => {
    // 模拟 map 膨胀污染:size=10(≡0)但值只占 {P0, P5} —— 新键 %10=0 撞 P0 → 顺延到空槽 P1
    const prev = new Map<string, string>([['x0', PALETTE[0]]]);
    for (let i = 1; i <= 9; i++) prev.set(`dup${i}`, PALETTE[5]);
    expect(prev.size).toBe(10);
    const next = assignStableColors(prev, ['new-key']);
    expect(next.get('new-key')).toBe(PALETTE[1]);
    expect(next.get('new-key')).not.toBe(next.get('x0'));
  });
});

describe('stable colours end-to-end (run + value channels)', () => {
  const rs = [run({ run_id: 'r1', config: { lr: 0.1 } }), run({ run_id: 'r2', config: { lr: 0.2 } })];

  it('keeps both run and value assignments while the visible set shrinks', () => {
    // Workspace.syncColors 语义:先补选中 run,再为各卡 colorBy 预填 value 色
    const valueKeys = rs.map((r) => colorValueOf(r, { kind: 'config', path: 'lr' }));
    const all = assignStableColors(new Map(), [...rs.map((r) => r.run_id), ...valueKeys]);
    expect(all.size).toBe(4);
    expect(all.get('r1')).toBe(PALETTE[0]);
    expect(all.get('0.1')).toBe(PALETTE[2]);

    // 隐藏 r2 后再 sync:既有键一个都不改色,也不回收槽位
    const again = assignStableColors(all, ['r1', ...valueKeys]);
    expect(again.get('r1')).toBe(PALETTE[0]);
    expect(all.get('r2')).toBe(PALETTE[1]); // 原映射不受影响
    expect(again.get('0.1')).toBe(PALETTE[2]);
    expect(again.get('0.2')).toBe(PALETTE[3]);
  });

  it('re-selecting a removed run gets its old colour back', () => {
    let map = assignStableColors(new Map(), ['r1', 'r2']);
    map = assignStableColors(map, ['r1']); // 卸选 r2(色不回收)
    map = assignStableColors(map, ['r1', 'r2']);
    expect(map.get('r2')).toBe(PALETTE[1]);
  });
});

describe('lineSeriesKey / colorKeysOf', () => {
  const rs = [run({ run_id: 'r1', config: { lr: 0.1 } }), run({ run_id: 'r2', config: { lr: 0.2 } })];

  it('keys one colour per (run, metric) so multi-metric cards never collapse to one colour', () => {
    // 键与显示名同构:<run>|<context>/<key>
    expect(lineSeriesKey('r1', { key: 'loss', context: 'train' })).toBe('r1|train/loss');
    expect(lineSeriesKey('r1', { key: 'loss', context: '' })).toBe('r1|loss');
    expect(lineSeriesKey('r1', { key: 'loss', context: 'eval' })).not.toBe(
      lineSeriesKey('r1', { key: 'loss', context: 'train' })
    );
  });

  it('collects line card keys for every visible run × metric', () => {
    const widgets = [
      { id: 'w', type: 'line' as const, metrics: [{ key: 'loss', context: 'train' }, { key: 'acc', context: '' }], w: 12, h: 4 },
    ];
    expect(colorKeysOf(rs, widgets)).toEqual(['r1|train/loss', 'r1|acc', 'r2|train/loss', 'r2|acc']);
  });

  it('with a series cache, only keys that actually have data take palette slots', () => {
    const widgets = [
      { id: 'a', type: 'line' as const, metrics: [{ key: 'loss', context: 'train' }, { key: 'acc', context: 'train' }], w: 12, h: 4 },
    ];
    // r1 的 loss 有数据、r2 的 acc 是空组 → 只有有数据的组合拿槽
    const pt = [{ step: 0, wall_time: 0, value: 1, idx: 0 }];
    const cache = new Map([
      ['r1', [{ run_id: 'r1', key: 'loss', context: 'train', points: pt }]],
      ['r2', [{ run_id: 'r2', key: 'acc', context: 'train', points: [] }]],
    ]);
    expect(lineSeriesKeys(rs, widgets, cache)).toEqual(['r1|train/loss']);
    // 空组回归:batch-query 对无数据 (run × context/指标) 也回空组,
    // 若算进键表 → 6 run × 5 context = 30 键绕 10 色板 → 同名指标跨 context 撞同色
    const polluted = new Map([
      ['r1', [{ run_id: 'r1', key: 'loss', context: 'train', points: pt }]],
      ['r2', [
        { run_id: 'r2', key: 'loss', context: 'train', points: [] },
        { run_id: 'r2', key: 'acc', context: 'train', points: [] },
      ]],
    ]);
    expect(lineSeriesKeys(rs, widgets, polluted)).toEqual(['r1|train/loss']);
  });

  it('honours metric run_ids: only checked runs take palette slots (勾选细化到 run)', () => {
    const widgets = [
      // loss 只勾了 r1;acc 无 run_ids(= 全部)
      { id: 'w', type: 'line' as const, metrics: [
        { key: 'loss', context: 'train', run_ids: ['r1'] },
        { key: 'acc', context: '' },
      ], w: 12, h: 4 },
    ];
    expect(lineSeriesKeys(rs, widgets)).toEqual(['r1|train/loss', 'r1|acc', 'r2|acc']);
    // 与画线同源:被 run_ids 挡掉的 (r2, loss) 不占色槽,否则未勾组合挤掉真实曲线的颜色
    const pt = [{ step: 0, wall_time: 0, value: 1, idx: 0 }];
    const cache = new Map([
      ['r1', [
        { run_id: 'r1', key: 'loss', context: 'train', points: pt },
        { run_id: 'r1', key: 'acc', context: '', points: pt },
      ]],
      ['r2', [
        { run_id: 'r2', key: 'loss', context: 'train', points: pt },
        { run_id: 'r2', key: 'acc', context: '', points: pt },
      ]],
    ]);
    expect(lineSeriesKeys(rs, widgets, cache)).toEqual(['r1|train/loss', 'r1|acc', 'r2|acc']);
  });

  it('splits keys into two channels: series (line) keys and run-scope keys', () => {
    const widgets = [
      { id: 'a', type: 'line' as const, metrics: [{ key: 'loss', context: 'train' }], w: 12, h: 4 },
      { id: 'b', type: 'scatter' as const, x: { kind: 'config' as const, path: 'lr' }, y: { kind: 'config' as const, path: 'lr' }, w: 12, h: 8 },
      { id: 'c', type: 'parallel' as const, dims: [{ kind: 'config' as const, path: 'lr' }], colorBy: { kind: 'config' as const, path: 'lr' }, w: 12, h: 8 },
    ];
    // 两个通道各自独立从色板槽 0 开始分配 —— 混在一张表里,line 卡首条线会拿到中间槽而"不按顺序"
    expect(lineSeriesKeys(rs, widgets)).toEqual(['r1|train/loss', 'r2|train/loss']);
    expect(runScopeKeys(rs, widgets)).toEqual(['r1', 'r2', '0.1', '0.2']);
  });

  it('keeps non-run colourBy keyed by its resolved value (shared colour is intentional there)', () => {
    const widgets = [
      { id: 'w', type: 'scatter' as const, x: { kind: 'config' as const, path: 'lr' }, y: { kind: 'config' as const, path: 'lr' }, colorBy: { kind: 'config' as const, path: 'lr' }, w: 12, h: 8 },
    ];
    expect(colorKeysOf(rs, widgets)).toEqual(['0.1', '0.2']);
  });
});

describe('PALETTE hue separation', () => {
  // hex → HSL 色相(度)
  function hue(hex: string): number {
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    if (max === min) return 0;
    let h = 0;
    if (max === r) h = ((g - b) / (max - min)) % 6;
    else if (max === g) h = (b - r) / (max - min) + 2;
    else h = (r - g) / (max - min) + 4;
    return (h * 60 + 360) % 360;
  }

  it('adjacent slots differ by at least 40° of hue (末尾几槽不再"几乎一样")', () => {
    const hues = PALETTE.map(hue);
    for (let i = 0; i < hues.length; i++) {
      const j = (i + 1) % hues.length;
      const diff = Math.abs(hues[i] - hues[j]);
      const wrapped = Math.min(diff, 360 - diff);
      expect(wrapped, `slot ${i}(${PALETTE[i]}) vs slot ${j}(${PALETTE[j]})`).toBeGreaterThanOrEqual(40);
    }
  });

  it('all ten slots are distinct colours', () => {
    expect(new Set(PALETTE).size).toBe(10);
  });
});

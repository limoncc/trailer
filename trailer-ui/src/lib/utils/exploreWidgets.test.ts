import { describe, it, expect } from 'vitest';
import { computeConfigDiff, buildSummaryRows, formatStat, assignStableColors, colorValueOf, PALETTE } from './exploreWidgets';
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

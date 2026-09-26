import { describe, it, expect } from 'vitest';
import {
  lowerIsBetter,
  summaryBars,
  diffKeyRows,
  diffRowsNeeded,
  SUMMARY_STATS,
  MIN_BAR_PCT,
  NONE_VALUE,
} from './exploreViz';
import type { RunRecord, MetricRef } from './explore';
import type { SummaryTable, ConfigDiffRow } from './exploreWidgets';

function run(id: string, config: Record<string, unknown> = {}): RunRecord {
  return {
    run_id: id,
    name: null,
    state: 'finished',
    project: 'p1',
    created_at: 1,
    sweep_id: null,
    config,
    summary: {},
    owner_id: null,
  };
}

const loss: MetricRef = { key: 'loss', context: '' };
const acc: MetricRef = { key: 'accuracy', context: '' };

describe('SUMMARY_STATS', () => {
  it('exposes four stat ids in display order', () => {
    expect(SUMMARY_STATS.map((s) => s.id)).toEqual(['last', 'best', 'min', 'max']);
  });
});

describe('lowerIsBetter (mirrors backend infer_direction)', () => {
  it('defaults to lower-is-better for loss (not in maximize table)', () => {
    expect(lowerIsBetter(loss)).toBe(true);
    expect(lowerIsBetter({ key: 'nll', context: '' })).toBe(true);
  });

  it('accuracy hits a maximize keyword → higher is better', () => {
    expect(lowerIsBetter(acc)).toBe(false);
    expect(lowerIsBetter({ key: 'f1', context: '' })).toBe(false);
  });

  it('config.metric_directions explicit declaration overrides the name convention', () => {
    // loss 默认 min → 显式 max 覆盖
    const maxRuns = [run('r1', { metric_directions: { loss: 'maximize' } })];
    expect(lowerIsBetter(loss, maxRuns)).toBe(false);
    // acc 默认 max → 显式 min 覆盖
    const minRuns = [run('r1', { metric_directions: { accuracy: 'MIN' } })];
    expect(lowerIsBetter(acc, minRuns)).toBe(true);
    // 未声明该指标的 run 跳过,继续用命名约定
    expect(lowerIsBetter(loss, [run('r1', { metric_directions: { other: 'max' } })])).toBe(true);
  });
});

function table(cells: Array<Record<string, number | undefined>>): SummaryTable {
  return {
    metrics: [loss],
    rows: cells.map((c, i) => ({
      runId: `r${i + 1}`,
      cells: [c as never],
    })),
  };
}

describe('summaryBars', () => {
  it('sorts best-first with pct 100 / MIN_BAR_PCT, undefined sinks to the bottom', () => {
    const t = table([
      { last: 0.4, best: 0.4, min: 0.4, max: 0.4 },
      { last: 0.1, best: 0.1, min: 0.1, max: 0.1 },
      {}, // r3 无值
    ]);
    const out = summaryBars(t, { metricIndex: 0, stat: 'best', lowerIsBetter: true });
    expect(out.rows.map((r) => r.runId)).toEqual(['r2', 'r1', 'r3']);
    expect(out.rows[0].pct).toBe(100);
    expect(out.rows[1].pct).toBe(MIN_BAR_PCT);
    expect(out.rows[2].pct).toBeNull();
    expect(out.rows[2].display).toBe('—');
    expect(out.rows[0].isBest).toBe(true);
    expect(out.bestRunId).toBe('r2');
    expect(out.bestValue).toBe(0.1);
  });

  it('flips sort and pct when direction flips', () => {
    const t = table([
      { best: 0.4 },
      { best: 0.1 },
    ]);
    const lower = summaryBars(t, { metricIndex: 0, stat: 'best', lowerIsBetter: true });
    const higher = summaryBars(t, { metricIndex: 0, stat: 'best', lowerIsBetter: false });
    expect(lower.rows.map((r) => r.runId)).toEqual(['r2', 'r1']);
    expect(higher.rows.map((r) => r.runId)).toEqual(['r1', 'r2']);
    expect(higher.rows[0].pct).toBe(100);
    expect(higher.bestRunId).toBe('r1');
  });

  it('mean lands at 54% for the centered sample (formula: 8 + 92 * 0.5)', () => {
    const t = table([{ best: 0.4 }, { best: 0.1 }]);
    const out = summaryBars(t, { metricIndex: 0, stat: 'best', lowerIsBetter: true });
    expect(out.mean).toBeCloseTo(0.25);
    expect(out.meanPct).toBe(54);
  });

  it('all-equal values fall back to full bars (no divide-by-zero / NaN)', () => {
    const t = table([{ best: 0.7 }, { best: 0.7 }]);
    const out = summaryBars(t, { metricIndex: 0, stat: 'best', lowerIsBetter: true });
    expect(out.rows.every((r) => r.pct === 100)).toBe(true);
    expect(out.meanPct).toBe(100);
    expect(Number.isNaN(out.rows[0].pct as number)).toBe(false);
  });

  it('all values missing → nulls everywhere, no crash', () => {
    const t = table([{}, {}]);
    const out = summaryBars(t, { metricIndex: 0, stat: 'best', lowerIsBetter: true });
    expect(out.bestRunId).toBeNull();
    expect(out.mean).toBeUndefined();
    expect(out.meanPct).toBeNull();
    expect(out.rows.every((r) => r.pct === null && !r.isBest)).toBe(true);
  });

  it('display follows formatStat (4 significant digits / em dash)', () => {
    const t = table([{ best: 0.5 }, {}]);
    const out = summaryBars(t, { metricIndex: 0, stat: 'best', lowerIsBetter: true });
    expect(out.rows.find((r) => r.runId === 'r1')!.display).toBe('0.5000');
    expect(out.rows.find((r) => r.runId === 'r2')!.display).toBe('—');
  });

  it('exposes best_step only for the best stat', () => {
    const t = table([{ best: 0.1, best_step: 42 }]);
    const withBest = summaryBars(t, { metricIndex: 0, stat: 'best', lowerIsBetter: true });
    expect(withBest.rows[0].step).toBe(42);
    const withLast = summaryBars(t, { metricIndex: 0, stat: 'last', lowerIsBetter: true });
    expect(withLast.rows[0].step).toBeUndefined();
  });
});

describe('diffKeyRows (一个键一行,行内每 run 一卡,点卡设 base)', () => {
  const rs = [run('r1'), run('r2'), run('r3')];
  const colorOf = (r: RunRecord) => (r.run_id === 'r1' ? '#111111' : r.run_id === 'r2' ? '#222222' : '#333333');
  const rows = (paths: Array<[string, string[]]>): ConfigDiffRow[] =>
    paths.map(([path, values]) => ({ path, values }));

  it('defaults base to the first run; delta = (v-base)/base*100', () => {
    const out = diffKeyRows(rs, rows([['reward', ['0.15', '0.3', '0.3']]]), { colorOf });
    expect(out).toHaveLength(1);
    const row = out[0];
    expect(row.baseRunId).toBe('r1');
    expect(row.cards[0].isBase).toBe(true);
    expect(row.cards[0].deltaPct).toBe(0);
    expect(row.cards[1].deltaPct).toBeCloseTo(100); // (0.3-0.15)/0.15
    expect(row.cards[1].seq).toBe(2);
    expect(row.cards[1].color).toBe('#222222');
  });

  it('re-bases when baseByPath points at another run', () => {
    const out = diffKeyRows(rs, rows([['k', ['1', '1', '0.5']]]), {
      baseByPath: { k: 'r3' },
      colorOf,
    });
    expect(out[0].baseRunId).toBe('r3');
    // r1/r2 = 1 相对 base 0.5 → +100%
    expect(out[0].cards[0].deltaPct).toBeCloseTo(100);
    expect(out[0].cards[2].deltaPct).toBe(0);
    expect(out[0].cards[2].isBase).toBe(true);
  });

  it('infers value type badges (int/float/bool/str)', () => {
    const out = diffKeyRows(
      rs,
      rows([
        ['a', ['1', '2', '3']],
        ['b', ['0.15', '0.3', '0.7']],
        ['c', ['true', 'false', 'true']],
        ['d', ['x', 'y', '(none)']],
      ]),
      { colorOf }
    );
    expect(out.map((r) => r.valueType)).toEqual(['int', 'float', 'bool', 'str']);
  });

  it('flags all-equal rows as same and (none)/non-numeric deltas as null', () => {
    const out = diffKeyRows(rs, rows([['k', ['(none)', '(none)', '(none)']]]), { colorOf });
    expect(out[0].same).toBe(true);
    // base 非数值 → 全 null(base 自己仍是 0)
    expect(out[0].cards[0].deltaPct).toBe(0);
    expect(out[0].cards[1].deltaPct).toBeNull();
    expect(out[0].cards[1].value).toBe(NONE_VALUE);
  });

  it('guards divide-by-zero base', () => {
    const out = diffKeyRows(rs, rows([['k', ['0', '5', '0']]]), { colorOf });
    expect(out[0].cards[0].deltaPct).toBe(0); // base 自己
    expect(out[0].cards[1].deltaPct).toBeNull(); // base=0 且 v≠0 → 无法算
    expect(out[0].cards[2].deltaPct).toBe(0); // 0 vs 0 → 0
  });
});

describe('diffRowsNeeded (自动高度贴合网格行)', () => {
  it('grows with key count and caps at DIFF_MAX_AUTO_ROWS', () => {
    const few = diffRowsNeeded(3, 3, 600);
    const many = diffRowsNeeded(20, 3, 600);
    expect(few).toBeGreaterThanOrEqual(2);
    expect(many).toBeGreaterThan(few);
    expect(diffRowsNeeded(85, 6, 600)).toBe(30); // 上限防撑爆
  });

  it('narrow cards wrap more card lines → more rows', () => {
    const wide = diffRowsNeeded(5, 6, 1000);
    const narrow = diffRowsNeeded(5, 6, 320);
    expect(narrow).toBeGreaterThan(wide);
  });

  it('empty content falls back to the 2-row hint', () => {
    expect(diffRowsNeeded(0, 6, 600)).toBe(2);
  });
});

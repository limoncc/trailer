/**
 * Explore 看板 Diff/Summary 卡的**视图派生层**(纯函数)。
 *
 * 与 exploreWidgets(数据快照层)分层:那边算「有什么数据」,这边算「怎么画」。
 * 不依赖组件/ExploreCtx,便于单测;数据层契约(exploreWidgets.test)不受影响。
 */
import type { MetricRef, RunRecord, SummaryStats } from './explore';
import { PALETTE, formatStat, type ConfigDiffRow, type SummaryTable } from './exploreWidgets';

// ─── Summary:统计口径 ───

export type SummaryStat = 'last' | 'best' | 'min' | 'max';

export const SUMMARY_STATS = [
  { id: 'last', label: 'Last' },
  { id: 'best', label: 'Best' },
  { id: 'min', label: 'Min' },
  { id: 'max', label: 'Max' },
] as const;

/**
 * 该指标是否「越小越好」。**镜像后端 `crates/trailer-core/src/taps.rs infer_direction`**
 * —— `SummaryStats.best` 就是按这张规则算的,BEST 徽章必须与它同源,否则语义打架:
 * 1) run.config.metric_directions 显式声明优先(首个声明了该指标的 run;max/maximize → false,min/minimize → true)
 * 2) 命名约定:maximize 关键词(contains 匹配)→ 越大越好
 * 3) 默认:越小越好
 */
const MAXIMIZE_KEYWORDS = [
  'acc', 'accuracy', 'auc', 'f1', 'recall', 'precision', 'score',
  'iou', 'ndcg', 'miou', 'ap', 'dice', 'mcc',
];

export function lowerIsBetter(metric: MetricRef, runs?: RunRecord[]): boolean {
  if (runs) {
    for (const r of runs) {
      const dirs = r.config?.metric_directions;
      if (!dirs || typeof dirs !== 'object') continue;
      const v = (dirs as Record<string, unknown>)[metric.key];
      if (typeof v !== 'string') continue;
      const s = v.toLowerCase();
      if (s === 'max' || s === 'maximize') return false;
      if (s === 'min' || s === 'minimize') return true;
    }
  }
  const key = metric.key.toLowerCase();
  return !MAXIMIZE_KEYWORDS.some((k) => key.includes(k));
}

// ─── Summary:条形对比派生 ───

/** 最差行也留一小截,免得 0% 不可见 */
export const MIN_BAR_PCT = 8;

export interface SummaryBarRow {
  runId: string;
  /** 当前 stat 口径的原始值;undefined = 该 run 无此指标 */
  value: number | undefined;
  /** formatStat(value):4 位有效数字 / '—' */
  display: string;
  /** 方向感知的好度归一 8..100;null = 无值(不画填充) */
  pct: number | null;
  isBest: boolean;
  /** stat === 'best' 时透传 best_step(做 title) */
  step?: number;
}

export interface SummaryBars {
  /** 已排序:优→劣(稳定排序,同值保持原 run 序),undefined 置底 */
  rows: SummaryBarRow[];
  bestRunId: string | null;
  bestValue: number | undefined;
  mean: number | undefined;
  /** 均值在条形上的位置;全无值 → null */
  meanPct: number | null;
}

/**
 * 条形归一化公式(方向感知的好度):
 *   t(v) = max===min ? 1 : (lower ? max-v : v-min) / (max-min)   // 分母0兜底 → 全 1
 *   pct  = MIN_BAR_PCT + (100 - MIN_BAR_PCT) * t                 // best=100, worst=8
 */
export function summaryBars(
  table: SummaryTable,
  opts: { metricIndex: number; stat: SummaryStat; lowerIsBetter: boolean }
): SummaryBars {
  const { metricIndex, stat, lowerIsBetter: lower } = opts;
  const raw = table.rows.map((r) => {
    const cell = r.cells[metricIndex];
    const value = cell ? cell[stat] : undefined;
    return {
      runId: r.runId,
      value,
      display: formatStat(value),
      step: stat === 'best' ? cell?.best_step : undefined,
    };
  });

  const vals = raw.flatMap((r) => (r.value === undefined ? [] : [r.value]));
  if (vals.length === 0) {
    return {
      rows: raw.map((r) => ({ ...r, pct: null, isBest: false })),
      bestRunId: null,
      bestValue: undefined,
      mean: undefined,
      meanPct: null,
    };
  }

  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const t = (v: number): number =>
    max === min ? 1 : lower ? (max - v) / (max - min) : (v - min) / (max - min);
  const pct = (v: number): number => MIN_BAR_PCT + (100 - MIN_BAR_PCT) * t(v);

  const bestValue = lower ? min : max;
  const bestRunId = raw.find((r) => r.value === bestValue)?.runId ?? null;
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;

  const rows = raw
    .map((r) => ({
      ...r,
      pct: r.value === undefined ? null : pct(r.value),
      isBest: r.runId === bestRunId,
    }))
    .sort((a, b) => {
      if (a.pct === null && b.pct === null) return 0;
      if (a.pct === null) return 1; // 无值置底
      if (b.pct === null) return -1;
      return b.pct - a.pct; // 优→劣
    });

  return { rows, bestRunId, bestValue, mean, meanPct: pct(mean) };
}

// ─── Summary:多指标热力矩阵派生 ───

export interface MatrixCell {
  /** formatStat(当前口径) */
  display: string;
  num: number | null;
  /** 方向感知的列内归一 0..1(1=最优);null = 无值 */
  t: number | null;
  /** 该列最优(并列同标) */
  isBest: boolean;
}

export interface MatrixRow {
  runId: string;
  /** 与 metrics 平行 */
  cells: MatrixCell[];
  /** 各指标名次(1=最优,并列同名次;无值 = 有值数+1 垫底) */
  ranks: number[];
  /** ranks 平均,行按它升序(图:综合 avg rank) */
  avgRank: number;
}

/**
 * 多指标矩阵:每列(指标)独立按方向归一化着色,列内最优标白点,
 * 行综合 = 各列名次平均并按它升序(参考"多指标矩阵对比"设计稿)。
 * `lowers` 与 metrics 平行(每指标独立方向:箭头切换)。
 */
export function summaryMatrix(
  table: SummaryTable,
  opts: {
    stats: SummaryStat[];
    lowers: boolean[];
    /** 行按该指标的名次升序(综合依据 = 用户最后操作的指标);缺省按 avg rank */
    sortByIndex?: number;
  }
): { rows: MatrixRow[] } {
  const { stats, lowers, sortByIndex } = opts;
  const cols = table.metrics.map((_, ci) => {
    const stat = stats[ci] ?? 'best';
    const vals = table.rows.map((r) => {
      const cell = r.cells[ci];
      return cell ? cell[stat] : undefined;
    });
    const valid = vals.filter((v): v is number => v !== undefined);
    const min = valid.length > 0 ? Math.min(...valid) : null;
    const max = valid.length > 0 ? Math.max(...valid) : null;
    const lower = lowers[ci] ?? true;
    const ts = vals.map((v): number | null => {
      if (v === undefined || min === null || max === null) return null;
      if (max === min) return 1;
      return lower ? (max - v) / (max - min) : (v - min) / (max - min);
    });
    const present = ts.filter((t): t is number => t !== null);
    const sortedDesc = [...present].sort((a, b) => b - a);
    const ranks = ts.map((t) => (t === null ? present.length + 1 : sortedDesc.indexOf(t) + 1));
    const bestT = present.length > 0 ? Math.max(...present) : null;
    return { vals, ts, ranks, bestT };
  });

  const rows: MatrixRow[] = table.rows.map((r, ri) => {
    const cells: MatrixCell[] = cols.map((cd) => ({
      display: formatStat(cd.vals[ri]),
      num: cd.vals[ri] ?? null,
      t: cd.ts[ri],
      isBest: cd.bestT !== null && cd.ts[ri] !== null && cd.ts[ri] === cd.bestT,
    }));
    const ranks = cols.map((cd) => cd.ranks[ri]);
    const avgRank = ranks.length > 0 ? ranks.reduce((a, b) => a + b, 0) / ranks.length : 0;
    return { runId: r.runId, cells, ranks, avgRank };
  });
  if (sortByIndex != null && sortByIndex >= 0 && sortByIndex < (cols.length || 0)) {
    rows.sort((a, b) => a.ranks[sortByIndex] - b.ranks[sortByIndex]); // 按依据指标名次升序
  } else {
    rows.sort((a, b) => a.avgRank - b.avgRank); // 兜底按综合;稳定 → 并列保持原 run 序
  }
  return { rows };
}

/**
 * Summary 同名指标合并:勾了同 key 多 context(如 `loss/train/s1_seq32k` 与
 * `loss/train/s2_seq256k_20b` —— 同一个 loss,只是训练阶段不同)时合成一列,
 * 列头不再出现一排无法区分的 `train/loss`。
 * - 每 run 取**自己有值的 context 中字典序最靠后**的一个(阶段名 s1<s2<s3 自然有序)
 * - 代表 metric = 组内 context 最大者(列头/状态键与取值同源)
 * - 列序按 key 首见位置;无重复 key 时原样返回(引用不变)
 */
export function mergeSummaryContexts(table: SummaryTable): SummaryTable {
  const byKey = new Map<string, number[]>();
  table.metrics.forEach((m, i) => {
    const arr = byKey.get(m.key);
    if (arr) arr.push(i);
    else byKey.set(m.key, [i]);
  });
  if (byKey.size === table.metrics.length) return table; // 每 key 只有一列,无需合并

  const metrics: MetricRef[] = [];
  const merged: Array<Array<SummaryStats | undefined>> = table.rows.map(() => []);
  const seen = new Set<string>();
  table.metrics.forEach((m, i) => {
    if (seen.has(m.key)) return;
    seen.add(m.key);
    const idxs = byKey
      .get(m.key)!
      .sort((a, b) => table.metrics[a].context.localeCompare(table.metrics[b].context));
    metrics.push(table.metrics[idxs[idxs.length - 1]]); // 代表 = 最靠后 context
    table.rows.forEach((r, ri) => {
      // 升序排列 → 从后往前找第一个有值 = 最靠后阶段
      let pick: SummaryStats | undefined;
      for (let k = idxs.length - 1; k >= 0; k--) {
        const cell = r.cells[idxs[k]];
        if (cell !== undefined) {
          pick = cell;
          break;
        }
      }
      merged[ri].push(pick);
    });
  });
  return { metrics, rows: table.rows.map((r, ri) => ({ runId: r.runId, cells: merged[ri] })) };
}

// ─── Config Diff:键行卡片流派生 ───

export const NONE_VALUE = '(none)';

export type DiffValueType = 'int' | 'float' | 'bool' | 'str';

export interface DiffRunCard {
  runId: string;
  /** 1-based,行内序号(= runs 序) */
  seq: number;
  /** 原样字符串值('(none)' 原样) */
  value: string;
  /** run 色(卡内点/序号/大数值同色) */
  color: string;
  /** 相对 base 的差异百分比:(v-base)/base*100;base=0 或不可解析 → null */
  deltaPct: number | null;
  isBase: boolean;
}

export interface DiffKeyRow {
  path: string;
  valueType: DiffValueType;
  /** 跨 run 值全等 */
  same: boolean;
  baseRunId: string;
  /** 与 runs 同序 */
  cards: DiffRunCard[];
}

/** 按值集合推断类型徽标(# int / # float / # bool) */
function inferValueType(values: string[]): DiffValueType {
  const vs = values.filter((v) => v !== NONE_VALUE);
  if (vs.length === 0) return 'str';
  if (vs.every((v) => /^(true|false)$/i.test(v))) return 'bool';
  if (vs.every((v) => /^-?\d+$/.test(v))) return 'int';
  if (vs.every((v) => v !== '' && Number.isFinite(Number(v)))) return 'float';
  return 'str';
}

/**
 * 一个 config 键一行、行内每 run 一张卡:
 * - `baseByPath[path]` = 用户点击的基准 run(缺省 runs[0]);其它卡显示相对它的差值百分比
 * - `same` = 跨 run 全等(行头 same/diff 徽章)
 * - `values` 与 runs 同序(computeConfigDiff 契约)
 */
/** diff 卡自动高度的内容上限(行数):点名全选 85 键时不把看板撑爆,超出内部滚动 */
export const DIFF_MAX_AUTO_ROWS = 30;

/**
 * 按内容估算 diff 卡需要的网格行数(与 infoCard.infoRowsNeeded 同思路的像素粗估):
 * 每键行 = 行头 20px + 卡片行数 × 84px;卡片 flex-wrap,每行张数按卡宽(min-w 128 + gap 6)算。
 * 最终对齐网格步进 (rowPx + gapPx),下限 2 行(空态文案)。
 */
export function diffRowsNeeded(
  keyCount: number,
  runsCount: number,
  cardWidthPx: number,
  rowPx = 44,
  gapPx = 8,
  /** 额外占用像素(编辑态 header 等) */
  extraPx = 0
): number {
  if (keyCount <= 0) return 2;
  const inner = Math.max(120, cardWidthPx - 12); // 内容区 p-1.5
  const perLine = Math.max(1, Math.floor((inner - 6) / 134)); // 卡 min-w 128 + gap 6
  const lines = Math.ceil(Math.max(1, runsCount) / perLine);
  // 键行实高 ≈94px(行头18 + 卡76:卡 p-1.5、行头 pb-0.5、数值/Δ mt-0.5 已压),
  // 落在 2 个网格行(96px)内 → 1 键零空隙;键间 gap 6 使多键量化余量 ≤10px
  const perKeyPx = 18 + lines * 76;
  const contentPx = keyCount * perKeyPx + Math.max(0, keyCount - 1) * 6;
  const rows = Math.ceil((contentPx + extraPx) / (rowPx + gapPx));
  return Math.min(DIFF_MAX_AUTO_ROWS, Math.max(2, rows));
}

export function diffKeyRows(
  runs: RunRecord[],
  rows: ConfigDiffRow[],
  opts: {
    baseByPath?: Readonly<Record<string, string>>;
    colorOf: (run: RunRecord) => string;
  }
): DiffKeyRow[] {
  const { baseByPath, colorOf } = opts;
  return rows.map((row) => {
    const same = row.values.length > 0 && row.values.every((v) => v === row.values[0]);
    const fallback = runs[0]?.run_id ?? '';
    const baseRunId =
      baseByPath?.[row.path] && runs.some((r) => r.run_id === baseByPath[row.path])
        ? baseByPath[row.path]
        : fallback;
    const baseIdx = runs.findIndex((r) => r.run_id === baseRunId);
    const baseNum = baseIdx >= 0 ? Number(row.values[baseIdx]) : NaN;
    const baseValid = Number.isFinite(baseNum);
    const cards: DiffRunCard[] = runs.map((r, i) => {
      const value = row.values[i] ?? NONE_VALUE;
      const num = Number(value);
      const valid = Number.isFinite(num);
      let deltaPct: number | null = null;
      if (r.run_id === baseRunId) deltaPct = 0;
      else if (baseValid && valid) {
        if (baseNum === 0) deltaPct = num === 0 ? 0 : null; // 除零兜底
        else deltaPct = ((num - baseNum) / baseNum) * 100;
      }
      return {
        runId: r.run_id,
        seq: i + 1,
        value,
        color: colorOf(r),
        deltaPct,
        isBase: r.run_id === baseRunId,
      };
    });
    return { path: row.path, valueType: inferValueType(row.values), same, baseRunId, cards };
  });
}

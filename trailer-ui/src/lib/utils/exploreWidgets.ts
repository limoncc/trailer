/**
 * Explore 对比看板的纯数据层:消融 diff / 指标汇总表 / 稳定配色。
 * 只依赖 config + summary(打开时快照,不随 metrics 轮询刷新)。
 */

import {
  collectConfigPaths,
  collectSummaryOptions,
  getByPath,
  colorValueFor,
  type ColorSpec,
  type MetricRef,
  type RunRecord,
  type SeriesData,
  type SummaryStats,
} from './explore';

// ─── Explore 运行时上下文:Boards 不传(explore prop 缺省走原逻辑) ───

export interface ExploreCtx {
  /** 可见(未隐藏)的选中 run,稳定顺序 */
  runs: RunRecord[];
  /** run 显示名:name ?? run_id 前 12 位 */
  labelOf: (runId: string) => string;
  /** run 在给定着色维度下的色值(缺省 colorBy = run_id) */
  colorValueOf: (run: RunRecord, color?: ColorSpec) => string;
  /** 色值 → 稳定色(查 Workspace 维护的配色表,显隐不换色) */
  colorOfValue: (cv: string) => string;
  isRunning: (runId: string) => boolean;
  /** run_id → 指标组(scatter-pair 等直接取时序) */
  series: SeriesData;
}

/** 缺省按 run 着色 */
export function colorValueOf(run: RunRecord, color?: ColorSpec): string {
  return colorValueFor(run, color ?? { kind: 'run' });
}

// ─── 配置消融 diff:找出可见 run 之间取值不同的超参 ───

export interface ConfigDiffRow {
  /** 叶节点点路径(按字典序) */
  path: string;
  /** 与输入 runs 等长的展示值;缺失键为 "(none)" */
  values: string[];
}

/** 与 runs 顺序一一对应的展示值 */
function stringifyLeaf(v: unknown): string {
  return v === undefined ? '(none)' : String(v);
}

/**
 * 只保留「跨 run 取值不同」的 config 叶节点,按 path 排序。
 * 1 个或 0 个 run 无可比对象 → 空数组。
 */
export function computeConfigDiff(runs: RunRecord[]): ConfigDiffRow[] {
  if (runs.length < 2) return [];
  const rows: ConfigDiffRow[] = [];
  for (const path of collectConfigPaths(runs)) {
    const values = runs.map((r) => stringifyLeaf(getByPath(r.config ?? {}, path)));
    if (values.every((v) => v === values[0])) continue;
    rows.push({ path, values });
  }
  return rows;
}

// ─── 指标汇总表:Run × 每指标(Last/Best/Min/Max) ───

export interface SummaryTable {
  /** 列序(与每行 cells 平行);入参为空时取 summary key 并集 */
  metrics: MetricRef[];
  rows: Array<{
    runId: string;
    /** 与 metrics 平行;该 run 无此指标 → undefined */
    cells: Array<SummaryStats | undefined>;
  }>;
}

/** metrics 缺省 = 可见 run 的 summary key 并集 */
export function buildSummaryRows(runs: RunRecord[], metrics?: MetricRef[]): SummaryTable {
  const cols =
    metrics && metrics.length > 0
      ? metrics
      : collectSummaryOptions(runs).map((o) => ({ key: o.key, context: o.context }));
  const rows = runs.map((r) => ({
    runId: r.run_id,
    cells: cols.map((m) => (r.summary ?? {})[`${m.key}/${m.context}`]),
  }));
  return { metrics: cols, rows };
}

/** 表格单元格:缺失 → "—",数值 → 4 位有效数字 */
export function formatStat(v: number | undefined): string {
  return v === undefined ? '—' : v.toPrecision(4);
}

// ─── 稳定配色:颜色是「系列身份」的函数,显隐/排序变化不换色 ───

/** 与 WidgetContent 同款 10 色色板 */
export const PALETTE = [
  '#3b82f6', '#f97316', '#10b981', '#ef4444', '#8b5cf6',
  '#06b6d4', '#ec4899', '#84cc16', '#f59e0b', '#6366f1',
];

/**
 * 在既有映射上为新 key 分配色板槽位(首见序);已分配的 key 永不改色,
 * 移除的 key 不清除(重新出现仍拿原色)→ 隐藏 run 不触发其余系列重排。
 * 返回新 Map(不改入参)。
 */
export function assignStableColors(prev: Map<string, string>, keys: Iterable<string>): Map<string, string> {
  const next = new Map(prev);
  for (const k of keys) {
    if (next.has(k)) continue;
    next.set(k, PALETTE[next.size % PALETTE.length]);
  }
  return next;
}

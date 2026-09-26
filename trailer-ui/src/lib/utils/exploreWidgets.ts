/**
 * Explore 对比看板的纯数据层:消融 diff / 指标汇总表 / 稳定配色。
 * 只依赖 config + summary(打开时快照,不随 metrics 轮询刷新)。
 */

import type { DashWidget } from './dashboard';
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
/** paths 缺省/空 = 对比全部差异键;传入时只保留选中的 config 点路径 */
export function computeConfigDiff(runs: RunRecord[], paths?: string[]): ConfigDiffRow[] {
  if (runs.length < 2) return [];
  const wanted = paths && paths.length > 0 ? new Set(paths) : null;
  const rows: ConfigDiffRow[] = [];
  for (const path of collectConfigPaths(runs)) {
    if (wanted && !wanted.has(path)) continue;
    const values = runs.map((r) => stringifyLeaf(getByPath(r.config ?? {}, path)));
    // 只有"空 paths = 全部差异键"才筛掉无差异的列;点名选中的键即使各 run 相同也照显
    // (否则单独选 train.lr 这类同值键会整列消失、全选也只剩有差异的几列)
    if (!wanted && values.every((v) => v === values[0])) continue;
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

// ─── line 卡的系列键与显示名 ───

/** line 系列配色键:<run>|<context>/<key> —— 一卡一色,同 run 多指标不再挤同色 */
export function lineSeriesKey(runId: string, m: MetricRef): string {
  return `${runId}|${m.context ? `${m.context}/${m.key}` : m.key}`;
}

/** 显示名的 metric 段取 context 首段(如 train/s1_seq32k → train),短且够用 */
export function shortMetricPath(m: MetricRef): string {
  const ns = m.context ? m.context.split('/')[0] : '';
  return ns ? `${ns}/${m.key}` : m.key;
}

/** 显示名的 metric 段:完整 context/key(同卡短名冲突时用于消歧) */
export function fullMetricPath(m: MetricRef): string {
  return m.context ? `${m.context}/${m.key}` : m.key;
}

/** line 卡的系列键:(run, 指标) 组合,run 外层 —— 同 run 的几条线在色板上相邻。
 *  传入 series 缓存时**只算已有数据的组合**:否则 6 run × 5 指标 = 30 键会绕 10 色板循环,
 *  让没有数据的空组合挤掉槽位、真实曲线互相撞色。 */
export function lineSeriesKeys(
  runs: RunRecord[],
  widgets: DashWidget[],
  series?: SeriesData
): string[] {
  const keys: string[] = [];
  for (const w of widgets) {
    if (w.type !== 'line') continue;
    for (const r of runs) {
      const groups = series ? series.get(r.run_id) : undefined;
      for (const m of w.metrics) {
        // 勾选细化到 run:run_ids 里的 run 才占色槽(与画线过滤同源,否则未勾组合挤掉真实曲线颜色)
        if (m.run_ids && !m.run_ids.includes(r.run_id)) continue;
        // 必须查 points.length > 0:batch-query 对无数据组合也回一个**空组**,
        // 只查"组存在"会把 6 run × N 指标的全组合算进键(实测 42 键绕 10 色板 4 圈 →
        // 同卡的系列撞同色)—— 与 seriesLegend 的 drawn 过滤保持同一语义
        if (series && !groups?.some((g) => g.key === m.key && g.context === m.context && g.points.length > 0)) continue;
        keys.push(lineSeriesKey(r.run_id, m));
      }
    }
  }
  return keys;
}

/** run 级卡的着色键:colorBy 缺省/run → run_id;选了 config 等维度 → 其解析值。
 *  与 line 系列键**分表累积** —— 混在一张表里 line 卡首条线会拿到中间槽,颜色就不按色板顺序了。 */
export function runScopeKeys(runs: RunRecord[], widgets: DashWidget[]): string[] {
  const keys: string[] = [];
  for (const w of widgets) {
    if (w.type !== 'scatter' && w.type !== 'scatter-pair' && w.type !== 'parallel') continue;
    const cb = w.colorBy;
    for (const r of runs) keys.push(!cb || cb.kind === 'run' ? r.run_id : colorValueOf(r, cb));
  }
  return keys;
}

/** 收集全部配色键(两条通道合并,仅测试/调试用) */
export function colorKeysOf(runs: RunRecord[], widgets: DashWidget[]): string[] {
  return [...lineSeriesKeys(runs, widgets), ...runScopeKeys(runs, widgets)];
}

// ─── 稳定配色:颜色是「系列身份」的函数,显隐/排序变化不换色 ───

/** 与 WidgetContent 同款 10 色色板 = **G2 官方 category10**(AntV 经典色板,
 *  见 antv-g2-chart skill references/palette/g2-palette-category10):
 *  相邻色相最小 56°(自拼的 Tailwind 亮色在 55-150° 段会挤成同族),
 *  近色相靠饱和度/明度拉开(如 5D7092 灰蓝 vs 5B8FF9 亮蓝)。 */
export const PALETTE = [
  '#5B8FF9', '#5AD8A6', '#5D7092', '#F6BD16', '#6F5EF9',
  '#6DC8EC', '#945FB9', '#FF9845', '#1E9493', '#FF99C3',
];

/**
 * 在既有映射上为新 key 分配色板槽位(首见序);已分配的 key 永不改色,
 * 移除的 key 不清除(重新出现仍拿原色)→ 隐藏 run 不触发其余系列重排。
 * 返回新 Map(不改入参)。
 */
export function assignStableColors(prev: Map<string, string>, keys: Iterable<string>): Map<string, string> {
  const next = new Map(prev);
  const used = new Set(next.values());
  for (const k of keys) {
    if (next.has(k)) continue;
    // %10 可能落到已被占的槽(map 历史污染/回绕)→ 顺延找空色;
    // 十色耗尽(同批 >10 个不同键)才允许重复,绕一圈即停防死循环
    let i = next.size;
    let color = PALETTE[i % PALETTE.length];
    for (let tries = 0; tries < PALETTE.length && used.has(color); tries++) {
      i += 1;
      color = PALETTE[i % PALETTE.length];
    }
    next.set(k, color);
    used.add(color);
  }
  return next;
}

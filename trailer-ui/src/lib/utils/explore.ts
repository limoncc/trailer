/**
 * Explore — 灵活探索图表的数据层。
 *
 * 纯函数集合(无副作用),把 config/summary/metrics 三种数据源 join 成图表行。
 * ChartDef 描述一张图:x/y/颜色来源、log 变换、图型。
 */

export interface RunRecord {
  run_id: string;
  name: string | null;
  state: string;
  project: string;
  created_at: number;
  sweep_id: string | null;
  config: Record<string, unknown>;
  summary: Record<string, SummaryStats>;
  owner_id: number | null;
}

export interface SummaryStats {
  last?: number;
  best?: number;
  best_step?: number;
  min?: number;
  max?: number;
}

export interface MetricRef {
  key: string;
  context: string;
}

export type SummaryField = 'last' | 'best' | 'best_step' | 'min' | 'max';

/** 标量轴:来自 config 字段(点路径)或 summary 聚合值 */
export type ScalarAxis =
  | { kind: 'config'; path: string }
  | { kind: 'summary'; summaryKey: string; field: SummaryField };

/** 轴来源:标量 或 另一条指标的时序(reduce='none' 时按 step 内连接成对) */
export type AxisSource = ScalarAxis | { kind: 'metric'; metric: MetricRef; reduce: 'none' | SummaryField };

/** 颜色/系列分组:按 run、项目、或某标量维度 */
export type ColorSpec = { kind: 'run' } | { kind: 'project' } | ScalarAxis;

export type ChartDef =
  | {
      type: 'line';
      x: { kind: 'step' } | { kind: 'wall_time' };
      metrics: MetricRef[];
      color: ColorSpec;
      xLog?: boolean;
      yLog?: boolean;
      smooth?: boolean;
      /** 移动平均窗口(>1 启用 SMA) */
      smoothWindow?: number;
      maxPoints?: number;
    }
  | { type: 'scatter'; x: ScalarAxis; y: ScalarAxis; color: ColorSpec; xLog?: boolean; yLog?: boolean; regression?: boolean }
  | { type: 'scatter-pair'; x: { kind: 'metric'; metric: MetricRef }; y: { kind: 'metric'; metric: MetricRef }; color: ColorSpec; maxPoints?: number }
  | { type: 'parallel'; dims: ScalarAxis[]; color?: ColorSpec };

/** 把图表定义数组序列化到 URL query(base64),支持分享/回放 */
export function serializeDefs(defs: ChartDef[]): string {
  return btoa(encodeURIComponent(JSON.stringify(defs)));
}

/** 从 URL query 反序列化图表定义;无效输入返回 null */
export function deserializeDefs(s: string): ChartDef[] | null {
  try {
    const json = decodeURIComponent(atob(s));
    const parsed: unknown = JSON.parse(json);
    if (!Array.isArray(parsed)) return null;
    const defs = parsed as ChartDef[];
    // 兼容旧数据:line 的单 metric 自动转 metrics 数组
    for (const d of defs) {
      if (d.type === 'line' && !('metrics' in d) && (d as { metric?: MetricRef }).metric) {
        (d as { metrics: MetricRef[]; metric?: MetricRef }).metrics = [
          (d as { metric: MetricRef }).metric,
        ];
        delete (d as { metric?: MetricRef }).metric;
      }
    }
    return defs;
  } catch {
    return null;
  }
}

/** summary key 格式是 "{key}/{context}"(后端 format),key 本身可能含 '/' → 用最后一个 '/' 分割 */
export function parseSummaryKey(summaryKey: string): MetricRef {
  const i = summaryKey.lastIndexOf('/');
  if (i < 0) return { key: summaryKey, context: '' };
  return { key: summaryKey.slice(0, i), context: summaryKey.slice(i + 1) };
}

/** 收集所有 run config 的叶节点点路径(数值/字符串/布尔),嵌套用点号 */
export function collectConfigPaths(runs: RunRecord[]): string[] {
  const paths = new Set<string>();
  for (const r of runs) walkConfig(r.config ?? {}, '', paths);
  return [...paths].sort();
}

function walkConfig(obj: unknown, prefix: string, out: Set<string>): void {
  if (obj === null || typeof obj !== 'object') return;
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === 'object') {
      walkConfig(v, path, out);
    } else if (v !== undefined) {
      out.add(path);
    }
  }
}

export interface SummaryOption {
  summaryKey: string;
  key: string;
  context: string;
}

/** 收集所有 run 出现的 summary key 选项(去重) */
export function collectSummaryOptions(runs: RunRecord[]): SummaryOption[] {
  const seen = new Set<string>();
  const out: SummaryOption[] = [];
  for (const r of runs) {
    for (const summaryKey of Object.keys(r.summary ?? {})) {
      if (seen.has(summaryKey)) continue;
      seen.add(summaryKey);
      const { key, context } = parseSummaryKey(summaryKey);
      out.push({ summaryKey, key, context });
    }
  }
  return out.sort((a, b) => a.summaryKey.localeCompare(b.summaryKey));
}

/** 按点路径读取嵌套对象(如 "model.depth") */
export function getByPath(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, k) => {
    if (acc === null || acc === undefined || typeof acc !== 'object') return undefined;
    return (acc as Record<string, unknown>)[k];
  }, obj);
}

/** 解析一个 run 的标量轴值:config 字段(仅数值) 或 summary 聚合值。缺失返回 undefined */
export function resolveRunScalar(run: RunRecord, axis: ScalarAxis): number | undefined {
  if (axis.kind === 'config') {
    const v = getByPath(run.config ?? {}, axis.path);
    return typeof v === 'number' ? v : undefined;
  }
  const stats = (run.summary ?? {})[axis.summaryKey];
  if (!stats) return undefined;
  const v = stats[axis.field];
  return typeof v === 'number' ? v : undefined;
}

// ─── 图表数据构建(纯函数,series 由外部加载注入) ───

export interface MetricPoint {
  step: number;
  wall_time: number;
  value: number;
  idx: number;
}

export interface MetricGroup {
  run_id: string;
  key: string;
  context: string;
  points: MetricPoint[];
}

/** run_id → 该 run 的指标组 */
export type SeriesData = Map<string, MetricGroup[]>;

/** 颜色分组的字段名(行里的列名) */
export function colorFieldFor(color: ColorSpec): string {
  switch (color.kind) {
    case 'run':
      return 'run_id';
    case 'project':
      return 'project';
    case 'config':
      return `color_cfg_${color.path}`;
    case 'summary':
      return `color_sum_${color.summaryKey}`;
  }
}

/** 颜色分组的取值(字符串化,缺失用 "(none)") */
export function colorValueFor(run: RunRecord, color: ColorSpec): string {
  switch (color.kind) {
    case 'run':
      return run.run_id;
    case 'project':
      return run.project;
    case 'config': {
      const v = getByPath(run.config ?? {}, color.path);
      return v === undefined ? '(none)' : String(v);
    }
    case 'summary': {
      const v = resolveRunScalar(run, color);
      return v === undefined ? '(none)' : String(v);
    }
  }
}

/** Line 图:每 run 的指标时序展开为行,注入颜色字段值 */
export function buildLineRows(
  runs: RunRecord[],
  metrics: MetricRef[],
  color: ColorSpec,
  series: SeriesData,
): { rows: Array<Record<string, unknown>>; colorField: string } {
  // 合成 series 字段:每条 (run, metric) 组合一条线(run 色值 + 指标名)
  const colorField = '_series';
  const rows: Array<Record<string, unknown>> = [];
  for (const metric of metrics) {
    const label = metric.context ? `${metric.context}/${metric.key}` : metric.key;
    for (const r of runs) {
      const group = (series.get(r.run_id) ?? []).find((g) => g.key === metric.key && g.context === metric.context);
      if (!group) continue;
      const colorValue = colorValueFor(r, color);
      for (const p of group.points) {
        rows.push({
          run_id: r.run_id,
          step: p.step,
          wall_time: p.wall_time,
          value: p.value,
          _metric: label,
          _series: `${colorValue} | ${label}`,
        });
      }
    }
  }
  return { rows, colorField };
}

/** 标量散点:每 run 一个点,x/y 来自 config/summary(scaling law 主用) */
export function buildScalarScatterRows(
  runs: RunRecord[],
  x: ScalarAxis,
  y: ScalarAxis,
  color: ColorSpec,
): { rows: Array<Record<string, unknown>>; colorField: string } {
  const colorField = colorFieldFor(color);
  const rows: Array<Record<string, unknown>> = [];
  for (const r of runs) {
    const xv = resolveRunScalar(r, x);
    const yv = resolveRunScalar(r, y);
    if (xv === undefined || yv === undefined) continue;
    rows.push({ run_id: r.run_id, x: xv, y: yv, [colorField]: colorValueFor(r, color) });
  }
  return { rows, colorField };
}

/** 标量轴的列名(parallel/散点 axis 用),summary 反解成可读名如 "loss.last" */
export function scalarAxisName(axis: ScalarAxis): string {
  if (axis.kind === 'config') return `cfg.${axis.path}`;
  const { key, context } = parseSummaryKey(axis.summaryKey);
  const label = context ? `${context}/${key}` : key;
  return `${label}.${axis.field}`;
}

/** G2 把含点号的字段名当嵌套路径访问,扁平数据需用安全列名(点号 → __) */
export function safeFieldName(name: string): string {
  return name.replace(/\./g, '__');
}

/** 平行坐标:每 run 一行,列为各标量轴(值缺失的 run 跳过) */
export function buildParallelData(
  runs: RunRecord[],
  dims: ScalarAxis[],
): { rows: Array<Record<string, unknown>>; dimensions: string[] } {
  // 列名用安全名(点号 → __),避免 G2 把 cfg.lr / accuracy.last 当嵌套路径
  const dimensions = dims.map((d) => safeFieldName(scalarAxisName(d)));
  const rows: Array<Record<string, unknown>> = [];
  for (const r of runs) {
    const row: Record<string, unknown> = { run_id: r.run_id };
    let valid = true;
    for (let i = 0; i < dims.length; i++) {
      const v = resolveRunScalar(r, dims[i]);
      if (v === undefined) {
        valid = false;
        break;
      }
      row[dimensions[i]] = v;
    }
    if (valid) rows.push(row);
  }
  return { rows, dimensions };
}

/** 成对时序散点:两条指标按 step 内连接(loss vs accuracy) */
export function buildPairScatterRows(
  runs: RunRecord[],
  xMetric: MetricRef,
  yMetric: MetricRef,
  color: ColorSpec,
  series: SeriesData,
): { rows: Array<Record<string, unknown>>; colorField: string } {
  const colorField = colorFieldFor(color);
  const rows: Array<Record<string, unknown>> = [];
  for (const r of runs) {
    const groups = series.get(r.run_id) ?? [];
    const xg = groups.find((g) => g.key === xMetric.key && g.context === xMetric.context);
    const yg = groups.find((g) => g.key === yMetric.key && g.context === yMetric.context);
    if (!xg || !yg) continue;
    const yByStep = new Map(yg.points.map((p) => [p.step, p.value]));
    for (const p of xg.points) {
      const yv = yByStep.get(p.step);
      if (yv === undefined) continue;
      rows.push({ run_id: r.run_id, x: p.value, y: yv, [colorField]: colorValueFor(r, color) });
    }
  }
  return { rows, colorField };
}

export interface BatchQuery {
  run_id: string;
  key: string;
  context: string;
  max_points: number;
}

export type BatchFetcher = (queries: BatchQuery[]) => Promise<MetricGroup[]>;

const defaultFetcher: BatchFetcher = async (queries) => {
  const { api } = await import('./api');
  const resp = await api('/api/v1/metrics:batch-query', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ queries }),
  });
  if (!resp.ok) return [];
  return resp.json();
};

/** 加载缺失的指标时序到 cache(批量一次请求)。fetcher 可注入以便测试 */
export async function loadSeries(
  cache: SeriesData,
  runs: RunRecord[],
  metrics: MetricRef[],
  maxPoints = 1000,
  fetcher: BatchFetcher = defaultFetcher,
): Promise<SeriesData> {
  const missing: BatchQuery[] = [];
  for (const r of runs) {
    const groups = cache.get(r.run_id);
    for (const m of metrics) {
      const has = groups?.some((g) => g.key === m.key && g.context === m.context);
      if (!has) missing.push({ run_id: r.run_id, key: m.key, context: m.context, max_points: maxPoints });
    }
  }
  if (missing.length === 0) return cache;
  const results = await fetcher(missing);
  for (const g of results) {
    const arr = cache.get(g.run_id) ?? [];
    arr.push(g);
    cache.set(g.run_id, arr);
  }
  return cache;
}

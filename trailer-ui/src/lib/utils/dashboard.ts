import { parseSummaryKey, type MetricRef } from './explore';

// ─── Run 看板(Boards)布局模型 ───
// 持久化为 run_dashboards.layout 的 JSON 串;新增 widget 类型时:
// 1) 在此扩展 DashWidget 联合  2) widgetTypes.ts 注册元信息
// 3) WidgetContent.svelte 加渲染分支  4) WidgetPickerDialog.svelte 加选择分支
// parseLayout 对未知 type 返回时直接丢弃(向前兼容旧前端读新数据)。

export interface WidgetBase {
  id: string;
  /** 缺省 = 按内容自动生成标题 */
  title?: string;
  /** 12 列网格的跨列数 */
  w: number;
  /** 行数(每行 44px) */
  h: number;
}

export interface LineWidget extends WidgetBase {
  type: 'line';
  metrics: MetricRef[];
  xKind?: 'step' | 'wall_time';
  /** 平滑窗口(1..20,同 MetricCard 语义);0/缺省不平滑 */
  smooth?: number;
  yLog?: boolean;
}

export type LatestOrStep = 'latest' | number;

export interface HistWidget extends WidgetBase {
  type: 'hist';
  key: string;
  context: string;
  step?: LatestOrStep;
}

export interface FigureWidget extends WidgetBase {
  type: 'figure';
  name: string;
  step?: LatestOrStep;
}

export interface TextWidget extends WidgetBase {
  type: 'text';
  name: string;
  step?: LatestOrStep;
}

export interface TableWidget extends WidgetBase {
  type: 'table';
  tableId: number;
}

export interface MediaWidget extends WidgetBase {
  type: 'media';
  mediaId: number;
}

export type DashWidget =
  | LineWidget
  | HistWidget
  | FigureWidget
  | TextWidget
  | TableWidget
  | MediaWidget;

export interface DashboardLayout {
  version: 1;
  widgets: DashWidget[];
}

export const MIN_W = 3;
export const MAX_W = 12;
export const MIN_H = 4;
export const MAX_H = 40;
export const DEFAULT_W = 6;
export const DEFAULT_H = 10;

export function newWidgetId(): string {
  return `w_${Math.random().toString(16).slice(2, 10)}`;
}

const W_MIN = { line: 6, hist: 4, figure: 4, text: 4, table: 6, media: 4 } as const;

export function defaultSize(type: DashWidget['type']): { w: number; h: number } {
  switch (type) {
    case 'line':
      return { w: DEFAULT_W, h: DEFAULT_H };
    case 'hist':
      return { w: 6, h: 9 };
    case 'figure':
      return { w: 6, h: 10 };
    case 'text':
      return { w: 6, h: 8 };
    case 'table':
      return { w: 8, h: 12 };
    case 'media':
      return { w: 4, h: 8 };
  }
}

/** 类型允许的最小宽(比全局 MIN_W 更严的,按类型收紧) */
export function minWOf(type: DashWidget['type']): number {
  return Math.max(MIN_W, W_MIN[type] ?? MIN_W);
}

export function clampW(type: DashWidget['type'], w: unknown): number {
  const n = typeof w === 'number' && Number.isFinite(w) ? Math.round(w) : DEFAULT_W;
  return Math.min(MAX_W, Math.max(minWOf(type), n));
}

export function clampH(h: unknown, fallback = DEFAULT_H): number {
  const n = typeof h === 'number' && Number.isFinite(h) ? Math.round(h) : fallback;
  return Math.min(MAX_H, Math.max(MIN_H, n));
}

/** 修复旧版按最后一个 / 拆分产生的坏 MetricRef(与 explore.healChartDefs 同规则) */
export function healMetric(m: unknown): MetricRef | null {
  if (typeof m !== 'object' || m === null) return null;
  const raw = m as { key?: unknown; context?: unknown };
  if (typeof raw.key !== 'string' || typeof raw.context !== 'string') return null;
  return raw.key.includes('/') ? parseSummaryKey(`${raw.key}/${raw.context}`) : { key: raw.key, context: raw.context };
}

function parseWidget(raw: unknown): DashWidget | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.type !== 'string') return null;
  const base = {
    id: typeof r.id === 'string' && r.id ? r.id : newWidgetId(),
    title: typeof r.title === 'string' && r.title ? r.title : undefined,
    w: clampW(r.type as DashWidget['type'], r.w),
    h: clampH(r.h),
  };
  switch (r.type) {
    case 'line': {
      const metrics = Array.isArray(r.metrics)
        ? r.metrics.map(healMetric).filter((m): m is MetricRef => m !== null)
        : [];
      if (metrics.length === 0) return null;
      const smooth =
        typeof r.smooth === 'number' && Number.isFinite(r.smooth)
          ? Math.min(20, Math.max(0, Math.round(r.smooth)))
          : undefined;
      return {
        ...base,
        type: 'line',
        metrics,
        xKind: r.xKind === 'wall_time' ? 'wall_time' : 'step',
        smooth: smooth && smooth > 0 ? smooth : undefined,
        yLog: r.yLog === true,
      };
    }
    case 'hist': {
      if (typeof r.key !== 'string' || !r.key) return null;
      return {
        ...base,
        type: 'hist',
        key: r.key,
        context: typeof r.context === 'string' ? r.context : '',
        step: parseStep(r.step),
      };
    }
    case 'figure':
    case 'text': {
      if (typeof r.name !== 'string' || !r.name) return null;
      return { ...base, type: r.type, name: r.name, step: parseStep(r.step) };
    }
    case 'table':
      if (typeof r.tableId !== 'number' || !Number.isFinite(r.tableId)) return null;
      return { ...base, type: 'table', tableId: r.tableId };
    case 'media':
      if (typeof r.mediaId !== 'number' || !Number.isFinite(r.mediaId)) return null;
      return { ...base, type: 'media', mediaId: r.mediaId };
    default:
      // 未知类型(更新版前端写入)——旧前端跳过渲染,不破坏整体布局
      return null;
  }
}

function parseStep(v: unknown): LatestOrStep | undefined {
  if (v === 'latest') return 'latest';
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  return undefined;
}

/** 容错解析服务端返回的 layout JSON 串;非法输入返回空布局 */
export function parseLayout(s: string | null | undefined): DashboardLayout {
  const empty: DashboardLayout = { version: 1, widgets: [] };
  if (!s) return empty;
  try {
    const obj = JSON.parse(s) as unknown;
    if (typeof obj !== 'object' || obj === null || !Array.isArray((obj as Record<string, unknown>).widgets))
      return empty;
    const seen = new Set<string>();
    const widgets = (obj as Record<string, unknown>).widgets
      .map(parseWidget)
      .filter((w): w is DashWidget => w !== null)
      .map((w) => {
        // id 去重(后端不约束唯一)
        if (seen.has(w.id)) return { ...w, id: newWidgetId() };
        seen.add(w.id);
        return w;
      });
    return { version: 1, widgets };
  } catch {
    return empty;
  }
}

export function serializeLayout(l: DashboardLayout): string {
  return JSON.stringify(l);
}

/** 卡片缺省标题:按内容自动生成 */
export function defaultWidgetTitle(w: DashWidget, display?: (m: MetricRef) => string): string {
  switch (w.type) {
    case 'line':
      return w.metrics.map((m) => (display ? display(m) : m.context ? `${m.key} [${m.context}]` : m.key)).join(' | ');
    case 'hist':
      return w.context ? `${w.key} [${w.context}]` : w.key;
    case 'figure':
    case 'text':
      return w.name;
    case 'table':
      return `Table #${w.tableId}`;
    case 'media':
      return `Media #${w.mediaId}`;
  }
}

/**
 * 按 context 分组自动生成起步看板:每个 context 一个多指标 line 卡。
 * 单 context 超过 8 条指标时拆分为多张卡,避免单图过密。
 */
export function defaultWidgets(
  metrics: MetricRef[],
  perChart = 8
): DashWidget[] {
  const byContext = new Map<string, MetricRef[]>();
  for (const m of metrics) {
    if (!byContext.has(m.context)) byContext.set(m.context, []);
    byContext.get(m.context)!.push(m);
  }
  const widgets: DashWidget[] = [];
  for (const [context, list] of [...byContext.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    for (let i = 0; i < list.length; i += perChart) {
      widgets.push({
        id: newWidgetId(),
        type: 'line',
        metrics: list.slice(i, i + perChart),
        xKind: 'step',
        w: DEFAULT_W,
        h: DEFAULT_H,
      });
    }
  }
  return widgets;
}

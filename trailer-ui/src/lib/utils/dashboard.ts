import {
  parseSummaryKey,
  scalarAxisName,
  type MetricRef,
  type ScalarAxis,
  type ColorSpec,
} from './explore';
import { parseFilterState, type FilterPersistState } from '../charts/lineFilter';

// ─── 看板布局模型(Boards 单 run 看板 + Explore 多 run 对比看板共用) ───
// 持久化为 run_dashboards.layout(Boards)/ explores.config.layout(Explore) 的 JSON 串;
// 新增 widget 类型时:
// 1) 在此扩展 DashWidget 联合 + parseWidget + defaultSize + defaultWidgetTitle
// 2) widgetTypes.ts 注册元信息(hosts 决定在哪个宿主出现)
// 3) WidgetContent.svelte 加渲染分支  4) WidgetPickerDialog.svelte 加选择分支
// parseLayout 对未知 type 返回时直接丢弃(向前兼容旧前端读新数据)。

/** 卡片吸附方向:与该侧相邻卡片的间距归零;可多选(如 up+left 组合)。
 *  legacy:snapPrev:true → ['left'],#48 的单字符串 → [字符串]。 */
export type SnapDir = 'up' | 'down' | 'left' | 'right';

const SNAP_DIRS: readonly string[] = ['up', 'down', 'left', 'right'];

const OPPOSITE_SNAP: Record<SnapDir, SnapDir> = { left: 'right', right: 'left', up: 'down', down: 'up' };

function parseSnapDirs(v: unknown): SnapDir[] | undefined {
  const list = Array.isArray(v) ? v : typeof v === 'string' ? [v] : [];
  const dirs = [...new Set(list.filter((x): x is SnapDir => typeof x === 'string' && SNAP_DIRS.includes(x)))];
  return dirs.length > 0 ? dirs : undefined;
}

export interface WidgetBase {
  id: string;
  /** 缺省 = 按内容自动生成标题 */
  title?: string;
  /** 卡片头自定义颜色(#rrggbb),缺省无色条 */
  color?: string;
  /** 吸附相邻卡片的方向列表(该侧间距归零,缝线合并为单线并去圆角) */
  snap?: SnapDir[];
  /** 36 列网格的跨列数 */
  w: number;
  /** 行数(每行 44px) */
  h: number;
}

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

export function normalizeColor(v: unknown): string | undefined {
  return typeof v === 'string' && HEX_COLOR_RE.test(v) ? v.toLowerCase() : undefined;
}

export interface LineWidget extends WidgetBase {
  type: 'line';
  metrics: MetricRef[];
  xKind?: 'step' | 'wall_time';
  /** 平滑窗口(1..20,同 MetricCard 语义);0/缺省不平滑 */
  smooth?: number;
  xLog?: boolean;
  yLog?: boolean;
  /** 系列着色来源(Explore 多 run 对比);缺省 = 按指标序取色板(Boards 原行为) */
  colorBy?: ColorSpec;
  /** Select/Exclude 过滤状态(brushMode/xWindow/excludes,随 layout 入库跨设备共享) */
  filter?: FilterPersistState;
}

// ─── Explore 对比看板专用卡(单 run 语义的 hist/figure/text/… 不进 Explore) ───

/** 标量散点:每 run 一个点,x/y 取 config 点路径或 summary 聚合值 */
export interface ScatterWidget extends WidgetBase {
  type: 'scatter';
  x: ScalarAxis;
  y: ScalarAxis;
  colorBy?: ColorSpec;
  xLog?: boolean;
  yLog?: boolean;
  /** 拟合趋势线 */
  regression?: boolean;
}

/** 成对时序散点:两条指标按 step 内连接(loss vs accuracy) */
export interface ScatterPairWidget extends WidgetBase {
  type: 'scatter-pair';
  x: MetricRef;
  y: MetricRef;
  colorBy?: ColorSpec;
}

/** 平行坐标:每 run 一折,轴为标量(config / summary) */
export interface ParallelWidget extends WidgetBase {
  type: 'parallel';
  dims: ScalarAxis[];
  colorBy?: ColorSpec;
}

/** 超参消融对比表:无配置,按可见 run 自动算出差异键 */
export interface DiffWidget extends WidgetBase {
  type: 'diff';
}

/** 指标汇总表:Run × 每指标(Last/Best/Min/Max);缺省取 summary key 并集 */
export interface SummaryWidget extends WidgetBase {
  type: 'summary';
  metrics?: MetricRef[];
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

/** PCA 3D 聚簇卡(figures 表 kind='pca',按 name 取该组全部 step,卡内滑块浏览) */
export interface PcaWidget extends WidgetBase {
  type: 'pca';
  name: string;
  step?: LatestOrStep;
}

/** 损失景观卡(figures 表 kind='landscape',按 name 取该组全部 step,卡内滑块/视图切换) */
export interface LandscapeWidget extends WidgetBase {
  type: 'landscape';
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

/** 信息卡主体瓦片来源:status=头部条(模型名+状态+step+时长,一张卡勾一次) /
 *  config 超参 / 当前步数下的指标值(带 Δ) / 训练成本(可自定义 label)。 */
export type InfoItem =
  | { src: 'status' }
  | { src: 'config'; path: string; label?: string }
  | { src: 'metric'; key: string; context: string; label?: string }
  | { src: 'cost'; label?: string };

export interface InfoWidget extends WidgetBase {
  type: 'info';
  /** 展示瓦片与顺序 */
  items: InfoItem[];
  /** GPU 卡数;缺省自动读 env.hardware.gpus 数量 */
  gpus?: number;
  /** 单价(每卡时);缺省只显示累计卡时 */
  unitPrice?: number;
  /** 成本金额币种;缺省 usd */
  currency?: 'usd' | 'cny';
  /** 模型名显示别名(双击改名);不改 config 原始值,空 = 显示 config 解析名 */
  modelLabel?: string;
  /** 模型名的 config 点路径;缺省依次尝试 model_name / train_model / model */
  modelPath?: string;
  /** 用户手动拖拽过高度:true = 高度取手动值(下限仍为内容自适应高度),false = 纯自适应 */
  hFixed?: boolean;
}

export type DashWidget =
  | LineWidget
  | HistWidget
  | FigureWidget
  | PcaWidget
  | LandscapeWidget
  | TextWidget
  | TableWidget
  | MediaWidget
  | InfoWidget
  | ScatterWidget
  | ScatterPairWidget
  | ParallelWidget
  | DiffWidget
  | SummaryWidget;

/** 信息卡所需的 run 元信息(run 页 /api/v1/runs 已有,向下传递避免重复请求) */
export interface RunInfo {
  /** run 创建时刻(秒),时长/成本起点 */
  createdAt?: number;
  /** 最后心跳(秒);终态 run 用它近似训练终点 */
  heartbeatAt?: number;
  config: Record<string, unknown> | null;
  /** env.hardware.gpus 数量(未上报时 undefined,由卡片手填兜底) */
  gpuCount?: number;
}

export interface DashboardLayout {
  /** v1 = 12 列网格,v2 = 24 列网格(历史);v3 = 36 列网格(当前)。parseLayout 统一返回 v3 语义 */
  version: 1 | 2 | 3;
  widgets: DashWidget[];
  /** 吸附模式:卡片间无间距 */
  compact?: boolean;
}

export const MIN_W = 3;
export const MAX_W = 36;
export const MIN_H = 2;
export const MAX_H = 40;
export const DEFAULT_W = 12;
export const DEFAULT_H = 4;

/** 每类型最小尺寸:info 卡同样取全局下限(瓦片格自适应换行,过窄单列排布) */
export function minSize(type: DashWidget['type']): { w: number; h: number } {
  if (type === 'info') return { w: 3, h: 2 };
  return { w: MIN_W, h: MIN_H };
}

export function newWidgetId(): string {
  return `w_${Math.random().toString(16).slice(2, 10)}`;
}

export function defaultSize(type: DashWidget['type']): { w: number; h: number } {
  switch (type) {
    case 'line':
      return { w: DEFAULT_W, h: DEFAULT_H };
    case 'hist':
      return { w: 12, h: 8 };
    case 'figure':
      return { w: 12, h: 4 };
    case 'pca':
      return { w: 12, h: 7 };
    case 'landscape':
      return { w: 12, h: 7 };
    case 'text':
      return { w: 9, h: 3 };
    case 'table':
      return { w: 12, h: 4 };
    case 'media':
      return { w: 9, h: 3 };
    case 'info':
      return { w: 9, h: 6 };
    case 'scatter':
    case 'scatter-pair':
    case 'parallel':
      return { w: 12, h: 8 };
    case 'diff':
      return { w: 12, h: 6 };
    case 'summary':
      return { w: 18, h: 6 };
  }
}

export function clampW(w: unknown, fallback = DEFAULT_W): number {
  const n = typeof w === 'number' && Number.isFinite(w) ? Math.round(w) : fallback;
  return Math.min(MAX_W, Math.max(MIN_W, n));
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

/** 解析标量轴(config 点路径 / summary 聚合值);非法返回 null(整卡丢弃) */
function parseScalarAxis(v: unknown): ScalarAxis | null {
  if (typeof v !== 'object' || v === null) return null;
  const r = v as Record<string, unknown>;
  if (r.kind === 'config') {
    return typeof r.path === 'string' && r.path ? { kind: 'config', path: r.path } : null;
  }
  if (r.kind === 'summary') {
    const f = r.field;
    if (typeof r.summaryKey !== 'string' || !r.summaryKey) return null;
    if (f !== 'last' && f !== 'best' && f !== 'best_step' && f !== 'min' && f !== 'max') return null;
    return { kind: 'summary', summaryKey: r.summaryKey, field: f };
  }
  return null;
}

/** 解析着色来源(run / project / 标量);缺失或非法 → undefined(缺省着色) */
function parseColorSpec(v: unknown): ColorSpec | undefined {
  if (typeof v !== 'object' || v === null) return undefined;
  const kind = (v as Record<string, unknown>).kind;
  if (kind === 'run' || kind === 'project') return { kind };
  return parseScalarAxis(v) ?? undefined;
}

function parseWidget(raw: unknown): DashWidget | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.type !== 'string') return null;
  const base = {
    id: typeof r.id === 'string' && r.id ? r.id : newWidgetId(),
    title: typeof r.title === 'string' && r.title ? r.title : undefined,
    color: normalizeColor(r.color),
    w: clampW(r.w),
    h: clampH(r.h),
    snap: parseSnapDirs(r.snap) ?? (r.snapPrev === true ? (['left'] as SnapDir[]) : undefined),
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
        xLog: r.xLog === true ? true : undefined,
        yLog: r.yLog === true,
        colorBy: parseColorSpec(r.colorBy),
        // 该分支显式构造,未知字段必丢——filter 必须显式解析(非法/缺失 → undefined)
        filter: parseFilterState(r.filter) ?? undefined,
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
    case 'pca':
    case 'landscape':
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
    case 'info': {
      const rawItems = Array.isArray(r.items) ? r.items : [];
      const items: InfoItem[] = [];
      for (const raw of rawItems) {
        if (typeof raw !== 'object' || raw === null) continue;
        const it = raw as Record<string, unknown>;
        if (it.src === 'config' && typeof it.path === 'string' && it.path) {
          items.push({ src: 'config', path: it.path, label: typeof it.label === 'string' && it.label ? it.label : undefined });
        } else if (it.src === 'metric' && typeof it.key === 'string' && it.key) {
          items.push({
            src: 'metric',
            key: it.key,
            context: typeof it.context === 'string' ? it.context : '',
            label: typeof it.label === 'string' && it.label ? it.label : undefined,
          });
        } else if (it.src === 'cost') {
          items.push({ src: 'cost', label: typeof it.label === 'string' && it.label ? it.label : undefined });
        } else if (it.src === 'status') {
          items.push({ src: 'status' });
        }
        // 未知 src(含旧版 step/elapsed,已移入卡片头部)丢弃
      }
      return {
        ...base,
        type: 'info',
        items,
        w: Math.max(minSize('info').w, base.w),
        h: Math.max(minSize('info').h, base.h),
        gpus: typeof r.gpus === 'number' && Number.isFinite(r.gpus) && r.gpus > 0 ? Math.round(r.gpus) : undefined,
        unitPrice:
          typeof r.unitPrice === 'number' && Number.isFinite(r.unitPrice) && r.unitPrice >= 0
            ? r.unitPrice
            : undefined,
        modelPath: typeof r.modelPath === 'string' && r.modelPath ? r.modelPath : undefined,
        modelLabel:
          typeof r.modelLabel === 'string' && r.modelLabel.trim() ? r.modelLabel.trim() : undefined,
        hFixed: r.hFixed === true ? true : undefined,
        currency: r.currency === 'cny' || r.currency === 'usd' ? r.currency : undefined,
      };
    }
    case 'scatter': {
      const x = parseScalarAxis(r.x);
      const y = parseScalarAxis(r.y);
      if (!x || !y) return null;
      return {
        ...base,
        type: 'scatter',
        x,
        y,
        colorBy: parseColorSpec(r.colorBy),
        xLog: r.xLog === true ? true : undefined,
        yLog: r.yLog === true ? true : undefined,
        regression: r.regression === true ? true : undefined,
      };
    }
    case 'scatter-pair': {
      const x = healMetric(r.x);
      const y = healMetric(r.y);
      if (!x || !y) return null;
      return { ...base, type: 'scatter-pair', x, y, colorBy: parseColorSpec(r.colorBy) };
    }
    case 'parallel': {
      if (!Array.isArray(r.dims)) return null;
      const dims = r.dims.map(parseScalarAxis).filter((d): d is ScalarAxis => d !== null);
      if (dims.length === 0) return null;
      return { ...base, type: 'parallel', dims, colorBy: parseColorSpec(r.colorBy) };
    }
    case 'diff':
      return { ...base, type: 'diff' };
    case 'summary': {
      const metrics = Array.isArray(r.metrics)
        ? r.metrics.map(healMetric).filter((m): m is MetricRef => m !== null)
        : [];
      return { ...base, type: 'summary', metrics: metrics.length > 0 ? metrics : undefined };
    }
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

/** 容错解析服务端返回的 layout JSON 串;统一归一为 v3(36 列)语义。
 *  历史版本按列数比例迁移宽度:v1(12 列)×3、v2(24 列)×1.5;
 *  并自愈早期 bug 写出的双层包裹 `{widgets:{version,widgets:[...]}}`。非法输入返回空布局。 */
export function parseLayout(s: string | null | undefined): DashboardLayout {
  const empty: DashboardLayout = { version: 3, widgets: [] };
  if (!s) return empty;
  try {
    const obj = JSON.parse(s) as unknown;
    if (typeof obj !== 'object' || obj === null) return empty;
    let rawWidgets = (obj as Record<string, unknown>).widgets;
    let version = (obj as Record<string, unknown>).version;
    if (
      !Array.isArray(rawWidgets) &&
      typeof rawWidgets === 'object' &&
      rawWidgets !== null &&
      Array.isArray((rawWidgets as Record<string, unknown>).widgets)
    ) {
      version = (rawWidgets as Record<string, unknown>).version;
      rawWidgets = (rawWidgets as Record<string, unknown>).widgets;
    }
    if (!Array.isArray(rawWidgets)) return empty;
    const compact = (obj as Record<string, unknown>).compact === true;
    // 按历史网格列数比例缩放宽度,视觉比例不变
    const scale = version === 2 ? 1.5 : version === 1 ? 3 : 1;
    const seen = new Set<string>();
    const widgets = rawWidgets
      .map(parseWidget)
      .filter((w): w is DashWidget => w !== null)
      .map((w) => {
        const scaled = scale === 1 ? w : { ...w, w: clampW(Math.round(w.w * scale)) };
        // id 去重(后端不约束唯一)
        if (seen.has(scaled.id)) return { ...scaled, id: newWidgetId() };
        seen.add(scaled.id);
        return scaled;
      });
    return { version: 3, widgets, compact };
  } catch {
    return empty;
  }
}

export function serializeLayout(l: DashboardLayout): string {
  return JSON.stringify({ version: 3, widgets: l.widgets, compact: l.compact === true });
}

// ─── 吸附缝线计算:谁去边框、谁去圆角 ───
// 卡片声明 snap 方向后与相邻卡片贴合,缝线要"合并为一条线且无圆角":
// 声明方该侧去边框+去圆角;被贴的相邻卡该侧只去圆角、保留边框(即缝线只剩这一条线)。
// 双方都声明同一条缝时两边都去边框(完全融合,无线)。指向空白处只去圆角不动边框。

interface PlacedWidget {
  id: string;
  widget: DashWidget;
  col: number;
  row: number;
  w: number;
  h: number;
}

export interface SnapSeams {
  /** 该侧去掉自身边框(有相邻卡时) */
  deborder: SnapDir[];
  /** 该侧拐角改直角 */
  square: SnapDir[];
}

/** 按 CSS grid dense 行优先规则模拟卡片落位,推导每张卡的缝线样式 */
export function computeSnapSeams(
  widgets: DashWidget[],
  heights?: Map<string, number>
): Map<string, SnapSeams> {
  const seams = new Map<string, SnapSeams>();
  for (const w of widgets) seams.set(w.id, { deborder: [], square: [] });
  if (widgets.length === 0) return seams;

  // 模拟 dense 落位(每张卡从头扫描找第一个能放下的位置)
  const occupied = new Set<string>();
  const placed: PlacedWidget[] = [];
  for (const w of widgets) {
    const ww = Math.min(MAX_W, Math.max(MIN_W, Math.round(w.w)));
    const wh = Math.max(MIN_H, Math.round(heights?.get(w.id) ?? w.h));
    let done = false;
    for (let row = 0; row < 10_000 && !done; row++) {
      for (let col = 0; col + ww <= MAX_W; col++) {
        let free = true;
        for (let r = row; r < row + wh && free; r++) {
          for (let c = col; c < col + ww && free; c++) {
            if (occupied.has(`${r}:${c}`)) free = false;
          }
        }
        if (!free) continue;
        for (let r = row; r < row + wh; r++) {
          for (let c = col; c < col + ww; c++) occupied.add(`${r}:${c}`);
        }
        placed.push({ id: w.id, widget: w, col, row, w: ww, h: wh });
        done = true;
        break;
      }
    }
  }

  const rowsOverlap = (a: PlacedWidget, b: PlacedWidget) => a.row < b.row + b.h && b.row < a.row + a.h;
  const colsOverlap = (a: PlacedWidget, b: PlacedWidget) => a.col < b.col + b.w && b.col < a.col + a.w;
  const dedupe = (dirs: SnapDir[]) => [...new Set(dirs)];

  for (const p of placed) {
    const dirs = p.widget.snap ?? [];
    const mine = seams.get(p.id)!;
    for (const d of dirs) {
      mine.square.push(d);
      // 该侧可能同时贴多张卡(如上边压着两行拼卡),每一张都要改直角
      const neighbors = placed.filter((q) => {
        if (q === p) return false;
        if (d === 'left') return q.col + q.w === p.col && rowsOverlap(p, q);
        if (d === 'right') return q.col === p.col + p.w && rowsOverlap(p, q);
        if (d === 'up') return q.row + q.h === p.row && colsOverlap(p, q);
        return q.row === p.row + p.h && colsOverlap(p, q);
      });
      if (neighbors.length > 0) {
        mine.deborder.push(d);
        for (const n of neighbors) seams.get(n.id)!.square.push(OPPOSITE_SNAP[d]);
      }
    }
  }
  for (const s of seams.values()) {
    s.deborder = dedupe(s.deborder);
    s.square = dedupe(s.square);
  }
  return seams;
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
    case 'pca':
      return w.name;
    case 'landscape':
      return w.name;
    case 'table':
      return `Table #${w.tableId}`;
    case 'media':
      return `Media #${w.mediaId}`;
    case 'info':
      return 'Training Info';
    case 'scatter':
      return `${scalarAxisName(w.x)} → ${scalarAxisName(w.y)}`;
    case 'scatter-pair': {
      const fmt = (m: MetricRef) => (display ? display(m) : m.context ? `${m.key} [${m.context}]` : m.key);
      return `${fmt(w.x)} vs ${fmt(w.y)}`;
    }
    case 'parallel':
      return `${w.dims.length} dims`;
    case 'diff':
      return 'Config Diff';
    case 'summary':
      return 'Summary';
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

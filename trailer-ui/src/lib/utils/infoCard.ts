import type { InfoItem, InfoWidget } from './dashboard';

// ─── Boards 信息卡纯逻辑(TDD,用例见 infoCard.test.ts) ───
// 头部条:状态点 + 模型名 + in progress + step + elapsed/started;
// 主体:大数字瓦片格(指标带 Δ vs step 1 / 成本 / config 值)。全英文展示。

export interface InfoMetrics {
  key: string;
  context: string;
  points: Array<{ step: number; value: number; idx: number; wall_time?: number }>;
}

export interface InfoCellInput {
  item: InfoItem;
  /** 训练时长(秒),由 trainingSeconds 从训练数据算出;缺省时内部自行计算 */
  seconds?: number | null;
  /** 回退用:无 wall_time 数据时的当前时刻(ms) */
  now?: number;
  /** run 创建时刻(秒) */
  createdAt?: number;
  /** 终态近似终点(秒,= 最后一次心跳) */
  endAt?: number;
  running?: boolean;
  /** GPU 卡数(widget 手填优先于 env 识别值,由调用方合并) */
  gpus?: number;
  unitPrice?: number;
  /** 成本金额币种 */
  currency?: Currency;
  config?: Record<string, unknown> | null;
  metrics: InfoMetrics[];
}

export interface InfoCell {
  label: string;
  value: string;
  /** 指标升降(Δ vs step 1),箭头+绝对值;deltaUp 区分颜色 */
  delta?: string;
  deltaUp?: boolean;
}

const round2 = (x: number) => Math.round(x * 100) / 100;

const fmtMetric = (v: number): string => {
  const s = String(v);
  const dot = s.indexOf('.');
  return dot === -1 || s.length - dot - 1 <= 6 ? s : v.toFixed(6);
};

/** 秒 → "HH:MM:SS",超过一天前缀 "Xd "(参考图 2d 03:45:12 样式) */
export function formatElapsed(totalSeconds: number): string {
  const sec = Math.floor(Number.isFinite(totalSeconds) ? Math.max(0, totalSeconds) : 0);
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const hhmmss = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return d > 0 ? `${d}d ${hhmmss}` : hhmmss;
}

/** 成本金额币种($ 缺省 / ¥ 可选,信息卡 picker 里切换) */
export type Currency = 'usd' | 'cny';

const CURRENCY_SYMBOL: Record<Currency, string> = { usd: '$', cny: '¥' };

/** 金额 → "$1,063,883";小额保留两位小数;currency 切换 ¥ */
export function formatMoney(amount: number, currency: Currency = 'usd'): string {
  const sym = CURRENCY_SYMBOL[currency] ?? '$';
  if (!Number.isFinite(amount)) return `${sym}0.00`;
  if (Math.abs(amount) >= 1000) {
    return `${sym}${Math.round(amount).toLocaleString('en-US')}`;
  }
  return `${sym}${amount.toFixed(2)}`;
}

/** 指标 Δ(最后一点 - 第一点);不足两个点返回 null */
export function metricDelta(
  points: Array<{ step: number; value: number; idx: number; wall_time?: number }>
): number | null {
  if (points.length < 2) return null;
  return points[points.length - 1].value - points[0].value;
}

/** Δ → "▲x"/"▼x";零变化返回 null(不显示)。浮点噪声截到 4 位小数 */
export function formatDelta(delta: number): string | null {
  if (!Number.isFinite(delta) || delta === 0) return null;
  const mag = Math.round(Math.abs(delta) * 10000) / 10000;
  return `${delta > 0 ? '▲' : '▼'}${fmtMetric(mag)}`;
}

/** run 状态 → 英文状态文本 */
export function statusFromRunState(state: string): string {
  switch (state) {
    case 'running':
      return 'in progress';
    case 'finished':
      return 'finished';
    case 'crashed':
      return 'crashed';
    case 'killed':
      return 'killed';
    default:
      return '';
  }
}

/** config 里取模型名:显式路径优先,再试常见 key(train_model 兜底);取到对象时走点路径 */
export function modelNameFromConfig(
  config: Record<string, unknown> | null | undefined,
  modelPath?: string
): string | undefined {
  if (!config) return undefined;
  const common = ['model_name', 'train_model', 'model'];
  const candidates = modelPath ? [modelPath, ...common] : common;
  for (const path of candidates) {
    const v = resolveConfigValue(config, path);
    if (v !== undefined && v !== '') return v;
  }
  return undefined;
}

/** 把 config 扁平化成点路径叶子 key 列表(空对象跳过,输出排序)——信息卡 picker 用 */
export function flattenConfigKeys(obj: Record<string, unknown> | null | undefined, prefix = ''): string[] {
  if (!obj) return [];
  const keys: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
      if (Object.keys(v).length > 0) keys.push(...flattenConfigKeys(v as Record<string, unknown>, path));
      // 空对象无展示价值,跳过
    } else {
      keys.push(path);
    }
  }
  return keys.sort((a, b) => a.localeCompare(b));
}

/** config 点路径取值("train.lr" → 嵌套对象);对象/数组 JSON 化,原始值 String() */
export function resolveConfigValue(
  config: Record<string, unknown> | null | undefined,
  path: string
): string | undefined {
  if (!config) return undefined;
  let cur: unknown = config;
  for (const seg of path.split('.')) {
    if (typeof cur !== 'object' || cur === null || !(seg in (cur as Record<string, unknown>))) {
      return undefined;
    }
    cur = (cur as Record<string, unknown>)[seg];
  }
  if (cur === undefined) return undefined;
  if (typeof cur === 'object' && cur !== null) return JSON.stringify(cur);
  return String(cur);
}

/** 训练时长(秒)来源于训练数据本身:全部指标点的 wall_time 跨度——
 *  数据在涨时间才在涨,训练结束/crash 后不再有新点,自然停止计数。
 *  点位缺 wall_time 时回退 createdAt→now(运行中)/heartbeat(终态);完全无数据返回 null。 */
export function trainingSeconds(input: Pick<InfoCellInput, 'metrics' | 'createdAt' | 'endAt' | 'running' | 'now'>): number | null {
  let start: number | null = null;
  let end: number | null = null;
  for (const s of input.metrics) {
    for (const p of s.points) {
      const w = p.wall_time;
      if (typeof w !== 'number' || !Number.isFinite(w)) continue;
      if (start === null || w < start) start = w;
      if (end === null || w > end) end = w;
    }
  }
  if (start !== null && end !== null) return Math.max(0, end - start);
  if (typeof input.createdAt !== 'number') return null;
  const nowSec = (input.now ?? Date.now()) / 1000;
  const endSec = input.running ? nowSec : (input.endAt ?? nowSec);
  return Math.max(0, endSec - input.createdAt);
}

/** 主体瓦片格单格渲染(指标带 Δ;成本=卡时或金额;config=k/v) */
export function formatCell(input: InfoCellInput): InfoCell {
  const { item } = input;
  switch (item.src) {
    case 'metric': {
      const base = item.label ?? (item.context ? `${item.key} [${item.context}]` : item.key);
      const series = input.metrics.find((m) => m.key === item.key && m.context === item.context);
      const points = series?.points ?? [];
      const last = points.length > 0 ? points[points.length - 1] : null;
      const delta = metricDelta(points);
      const cell: InfoCell = {
        label: `${base} · Δ vs step 1`,
        value: last ? fmtMetric(last.value) : '—',
      };
      const deltaText = delta !== null ? formatDelta(delta) : null;
      if (deltaText) {
        cell.delta = deltaText;
        cell.deltaUp = delta > 0;
      }
      return cell;
    }
    case 'cost': {
      const sec = typeof input.seconds === 'number' ? input.seconds : trainingSeconds(input);
      const gpus = input.gpus && input.gpus > 0 ? input.gpus : 0;
      const gpuHours = sec !== null ? round2((sec / 3600) * gpus) : null;
      const costLabel = item.label ?? 'train cost';
      if (gpuHours === null) return { label: costLabel, value: '—' };
      if (typeof input.unitPrice === 'number' && input.unitPrice >= 0) {
        return { label: costLabel, value: formatMoney(gpuHours * input.unitPrice, input.currency) };
      }
      return { label: costLabel, value: `${gpuHours.toFixed(2)} GPU·h` };
    }
    case 'config': {
      return {
        label: item.label ?? item.path,
        value: resolveConfigValue(input.config, item.path) ?? '—',
      };
    }
    default:
      // status 由卡片头部条渲染,不走瓦片格
      return { label: '', value: '—' };
  }
}

/** 模型名类 config 单元(model_name/train_model/model):由头部条展示,不再重复瓦片 */
export function isModelCell(item: InfoItem): boolean {
  return item.src === 'config' && /^(model_name|train_model|model)$/.test(item.path);
}

/** 是否渲染状态头部条:显式 status 项,或卡片含模型名 cell(自动升级为状态卡) */
export function hasStatusHeader(widget: InfoWidget): boolean {
  return widget.items.some((i) => i.src === 'status' || isModelCell(i));
}

/** 信息卡自动高度估算(行数):status 头部条 + 瓦片按 130px 最小宽换行。
 *  窄卡(内容宽 <200px)头部条左右两列放不下会换行成三行,按 124px 估算。
 *  用于让 info 卡贴合内容——不留大片空白也不出滚动条。 */
export function infoRowsNeeded(
  widget: InfoWidget,
  cardWidthPx: number,
  rowPx = 44,
  gapPx = 8
): number {
  const hasStatus = widget.items.some((i) => i.src === 'status');
  const cellCount = widget.items.filter((i) => i.src !== 'status').length;
  const tilesPerRow = Math.max(1, Math.floor((cardWidthPx - 20) / 110));
  const headerPx = hasStatus ? (cardWidthPx - 20 < 200 ? 124 : 62) : 0;
  const contentPx = headerPx + Math.ceil(cellCount / tilesPerRow) * 72;
  return Math.max(2, Math.ceil((contentPx + 16) / (rowPx + gapPx)));
}

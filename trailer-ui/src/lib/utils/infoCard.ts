import type { InfoItem } from './dashboard';

// ─── Boards 信息卡纯逻辑:时长格式化 / 成本计算 / config 取值 / 行渲染 ───
// 全部纯函数,便于 TDD;InfoCard.svelte 只负责组装与 tick。

export interface InfoMetrics {
  key: string;
  context: string;
  points: Array<{ step: number; value: number; idx: number; wall_time?: number }>;
}

export interface InfoRowInput {
  item: InfoItem;
  /** 当前时刻(ms);运行中时长/成本按它跳动 */
  now?: number;
  /** run 创建时刻(秒) */
  createdAt?: number;
  /** 终态近似终点(秒,= 最后一次心跳) */
  endAt?: number;
  running?: boolean;
  /** GPU 卡数(widget 手填优先于 env 识别值,由调用方合并) */
  gpus?: number;
  unitPrice?: number;
  config?: Record<string, unknown> | null;
  metrics: InfoMetrics[];
}

export interface InfoRow {
  label: string;
  value: string;
}

const round2 = (x: number) => Math.round(x * 100) / 100;

/** 秒 → "X天X小时X分钟X秒",前导零单位省略,全零/负数 → "0秒" */
export function formatDuration(totalSeconds: number): string {
  const sec = Math.floor(Number.isFinite(totalSeconds) ? Math.max(0, totalSeconds) : 0);
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const parts: string[] = [];
  if (d > 0) parts.push(`${d}天`);
  if (h > 0) parts.push(`${h}小时`);
  if (m > 0) parts.push(`${m}分钟`);
  if (s > 0) parts.push(`${s}秒`);
  return parts.length > 0 ? parts.join('') : '0秒';
}

/** 成本 = 时长(h) × 卡数 → 累计卡时;单价存在时折算金额(元) */
export function computeCost(input: {
  seconds: number;
  gpus?: number;
  unitPrice?: number;
}): { gpuHours: number; amount?: number } {
  const gpus = input.gpus && input.gpus > 0 ? input.gpus : 0;
  const seconds = Number.isFinite(input.seconds) ? Math.max(0, input.seconds) : 0;
  const gpuHours = round2((seconds / 3600) * gpus);
  if (typeof input.unitPrice === 'number' && input.unitPrice >= 0) {
    return { gpuHours, amount: round2(gpuHours * input.unitPrice) };
  }
  return { gpuHours };
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

const fmtMetric = (v: number): string => {
  const s = String(v);
  const dot = s.indexOf('.');
  return dot === -1 || s.length - dot - 1 <= 6 ? s : v.toFixed(6);
};

/** 单个信息行渲染:标签 + 展示值(值缺失统一 '—') */
export function formatInfoValue(input: InfoRowInput): InfoRow {
  const { item } = input;
  switch (item.src) {
    case 'step': {
      let maxStep: number | null = null;
      for (const series of input.metrics) {
        for (const p of series.points) {
          if (maxStep === null || p.step > maxStep) maxStep = p.step;
        }
      }
      return { label: '当前步数', value: maxStep === null ? '—' : String(maxStep) };
    }
    case 'metric': {
      const label = item.label ?? (item.context ? `${item.key} [${item.context}]` : item.key);
      const series = input.metrics.find((m) => m.key === item.key && m.context === item.context);
      const last = series && series.points.length > 0 ? series.points[series.points.length - 1] : null;
      return { label, value: last ? fmtMetric(last.value) : '—' };
    }
    case 'elapsed': {
      if (typeof input.createdAt !== 'number') return { label: '训练时长', value: '—' };
      const nowSec = (input.now ?? Date.now()) / 1000;
      const endSec = input.running ? nowSec : (input.endAt ?? nowSec);
      return { label: '训练时长', value: formatDuration(endSec - input.createdAt) };
    }
    case 'cost': {
      if (typeof input.createdAt !== 'number') return { label: '训练成本', value: '—' };
      const nowSec = (input.now ?? Date.now()) / 1000;
      const endSec = input.running ? nowSec : (input.endAt ?? nowSec);
      const { gpuHours, amount } = computeCost({
        seconds: endSec - input.createdAt,
        gpus: input.gpus,
        unitPrice: input.unitPrice,
      });
      let value = `${gpuHours.toFixed(2)} GPU·h`;
      if (typeof amount === 'number') value += ` · ¥${amount.toFixed(2)}`;
      return { label: '训练成本', value };
    }
    case 'config': {
      return {
        label: item.label ?? item.path,
        value: resolveConfigValue(input.config, item.path) ?? '—',
      };
    }
  }
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

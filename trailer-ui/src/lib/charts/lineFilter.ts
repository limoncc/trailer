/**
 * LineChart 框选过滤/排除的纯函数（与 G2 解耦，便于单测）。
 *
 * 三种过滤状态（互相独立、按序叠加）：
 * - xWindow：框选的 x 显示窗口（数据域；time 轴统一为 ms 数值），双击还原
 * - excludeRanges：排除模式下框选排除的 x 区段
 * - excludePoints：排除模式下点选排除的单点 key（pointKey）
 *
 * 过滤在数据行级完成 → G2 scale.y 不钉 domain 时 y 轴随可见数据自动变焦。
 */

export type XWindow = [number, number];
export type ExcludeRange = [number, number];

export type Row = Record<string, unknown>;

export interface FilterOptions {
  xField: string;
  seriesField?: string;
  xWindow?: XWindow | null;
  excludeRanges?: ExcludeRange[];
  excludePoints?: Set<string>;
}

/// 数值统一入口：Date（time 轴）转 ms，其余 Number()
export function toNum(v: unknown): number {
  return v instanceof Date ? v.getTime() : Number(v);
}

/// 点选排除的唯一 key：series（无则空串）+ x（ms/数值）
export function pointKey(series: string | null | undefined, x: number): string {
  return `${series ?? ''} ${x}`;
}

function normRange(r: [number, number]): XWindow {
  return r[0] <= r[1] ? [r[0], r[1]] : [r[1], r[0]];
}

function inRanges(x: number, ranges: ExcludeRange[]): boolean {
  for (const r of ranges) {
    const [lo, hi] = normRange(r);
    if (x >= lo && x <= hi) return true;
  }
  return false;
}

/**
 * 按 xWindow → excludeRanges → excludePoints 顺序过滤数据行。
 * 任一状态为空时原样返回（不复制数组）。
 */
export function filterLineData<T extends Row>(rows: T[], opts: FilterOptions): T[] {
  const { xField, seriesField, xWindow = null, excludeRanges = [], excludePoints } = opts;
  const hasWindow = !!xWindow && Number.isFinite(xWindow[0]) && Number.isFinite(xWindow[1]);
  const hasRanges = excludeRanges.length > 0;
  const hasPoints = !!excludePoints && excludePoints.size > 0;
  if ((!hasWindow && !hasRanges && !hasPoints) || rows.length === 0) return rows;

  const [w0, w1] = hasWindow ? normRange(xWindow as XWindow) : [NaN, NaN];

  return rows.filter((row) => {
    const x = toNum(row[xField]);
    if (!Number.isFinite(x)) return false;
    if (hasWindow && (x < w0 || x > w1)) return false;
    if (hasRanges && inRanges(x, excludeRanges)) return false;
    if (hasPoints) {
      const s = seriesField ? String(row[seriesField] ?? '') : null;
      if (excludePoints!.has(pointKey(s, x))) return false;
    }
    return true;
  });
}

// ─── 持久化（localStorage，键前缀同项目惯例 trailer-*；不入库，仅浏览器本地） ───

const FILTER_STORAGE_PREFIX = 'trailer-line-filter';

/// 持久化载荷：与组件状态一一对应（excludePoints 存 key 字符串数组）
export interface FilterPersistState {
  brushMode?: 'none' | 'select' | 'exclude';
  xWindow?: XWindow | null;
  excludeRanges?: ExcludeRange[];
  excludePoints?: string[];
}

function isRange(v: unknown): v is XWindow {
  return (
    Array.isArray(v) && v.length === 2 && Number.isFinite(v[0]) && Number.isFinite(v[1])
  );
}

/**
 * 按 storageKey 读回过滤状态。损坏/缺字段的条目安全降级
 * （非法字段丢弃，整体解析失败返回 null）。
 */
export function loadFilterState(key: string): FilterPersistState | null {
  if (typeof localStorage === 'undefined' || !key) return null;
  try {
    const raw = localStorage.getItem(`${FILTER_STORAGE_PREFIX}-${key}`);
    if (!raw) return null;
    const v: unknown = JSON.parse(raw);
    if (typeof v !== 'object' || v === null) return null;
    const out: FilterPersistState = {};
    const r = v as Record<string, unknown>;
    if (r.brushMode === 'select' || r.brushMode === 'exclude' || r.brushMode === 'none') {
      out.brushMode = r.brushMode;
    }
    if (isRange(r.xWindow)) out.xWindow = [r.xWindow[0], r.xWindow[1]];
    if (Array.isArray(r.excludeRanges)) {
      out.excludeRanges = r.excludeRanges.filter(isRange).map((p) => [p[0], p[1]]);
    }
    if (Array.isArray(r.excludePoints)) {
      out.excludePoints = r.excludePoints.filter((p): p is string => typeof p === 'string');
    }
    return out;
  } catch {
    return null;
  }
}

/// 按 storageKey 写入过滤状态；localStorage 不可用/超限时静默失败（同 columnConfig）
export function saveFilterState(key: string, state: FilterPersistState): void {
  if (typeof localStorage === 'undefined' || !key) return;
  try {
    localStorage.setItem(`${FILTER_STORAGE_PREFIX}-${key}`, JSON.stringify(state));
  } catch {
    /* ignore */
  }
}

export interface NearestOptions {
  xField: string;
  yField: string;
  /// 点击位置，coordinate.invert + scale.invert 得到的数据域坐标（time 轴为 ms/Date）
  clickX: number;
  clickY: number;
  /// 当前可见数据的域跨度（用于归一化 x/y 距离，消除量纲差异）
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  /// plot 区域像素尺寸 + 阈值:点太远视为误点返回 null。距离按
  /// ((Δx/xSpan)·W)² + ((Δy/ySpan)·H)² 计算(线性 scale 下即像素²,time/log 近似)。
  plotW?: number;
  plotH?: number;
  maxPixelDist?: number;
}

/**
 * 找离点击位置最近的数据点（归一化数据域距离）。
 * line mark 的 element:click 只给整条 series（seriesIndex 数组），
 * 单点排除必须按坐标自算——参考 G2 tooltip 的最近点按 x 找思路。
 * 数据域归一化距离不依赖 scale.map 的像素空间约定，time/log 轴均适用
 * （卡片数据量 ≤ 数千点，O(n) 足够）。
 */
export function findNearestDatum<T extends Row>(rows: T[], opts: NearestOptions): T | null {
  const { xField, yField, clickX, clickY, xMin, xMax, yMin, yMax, plotW, plotH, maxPixelDist } = opts;
  const xSpan = Number.isFinite(xMax - xMin) && xMax > xMin ? xMax - xMin : 1;
  const ySpan = Number.isFinite(yMax - yMin) && yMax > yMin ? yMax - yMin : 1;
  // 传了 plot 尺寸+阈值 → 直接按像素欧氏距离²比较((dx·W)²+(dy·H)²);
  // 否则退回归一化距离²(无阈值限制)。归一化距离不能直接换算像素——x/y 系数不同。
  const usePx = maxPixelDist != null && !!plotW && !!plotH;
  const maxD = usePx ? maxPixelDist! * maxPixelDist! : Infinity;
  const cx = toNum(clickX);
  let best: T | null = null;
  let bestD = Infinity;
  for (const row of rows) {
    const x = toNum(row[xField]);
    const y = Number(row[yField]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const dx = ((x - cx) / xSpan) * (usePx ? plotW! : 1);
    const dy = ((y - toNum(clickY)) / ySpan) * (usePx ? plotH! : 1);
    const d = dx * dx + dy * dy;
    if (d < bestD) {
      bestD = d;
      best = row;
    }
  }
  if (!best || bestD > maxD) return null;
  return best;
}

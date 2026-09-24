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

export interface NearestOptions {
  xField: string;
  yField: string;
  /// 点击位置，coordinate.invert 得到的数据域坐标（time 轴为 ms/Date）
  clickX: number;
  clickY: number;
  /// 当前可见数据的域跨度（用于归一化 x/y 距离，消除量纲差异）
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

/**
 * 找离点击位置最近的数据点（归一化数据域距离）。
 * line mark 的 element:click 只给整条 series（seriesIndex 数组），
 * 单点排除必须按坐标自算——参考 G2 tooltip 的最近点按 x 找思路。
 * 数据域归一化距离不依赖 scale.map 的像素空间约定，time/log 轴均适用
 * （卡片数据量 ≤ 数千点，O(n) 足够）。
 */
export function findNearestDatum<T extends Row>(rows: T[], opts: NearestOptions): T | null {
  const { xField, yField, clickX, clickY, xMin, xMax, yMin, yMax } = opts;
  const xSpan = Number.isFinite(xMax - xMin) && xMax > xMin ? xMax - xMin : 1;
  const ySpan = Number.isFinite(yMax - yMin) && yMax > yMin ? yMax - yMin : 1;
  const cx = toNum(clickX);
  let best: T | null = null;
  let bestD = Infinity;
  for (const row of rows) {
    const x = toNum(row[xField]);
    const y = Number(row[yField]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const dx = (x - cx) / xSpan;
    const dy = (y - toNum(clickY)) / ySpan;
    const d = dx * dx + dy * dy;
    if (d < bestD) {
      bestD = d;
      best = row;
    }
  }
  return best;
}

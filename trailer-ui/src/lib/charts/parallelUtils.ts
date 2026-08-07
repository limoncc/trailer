/**
 * 平行坐标图纯函数 —— 归一化/值域/颜色插值/折线点/布局。
 * 不依赖 DOM/Leafer,全部可单测(vitest)。
 */

/** min-max 归一化到 [0,1];min===max 时返回 0.5(防除零) */
export function normalizeValue(v: number, min: number, max: number): number {
  if (max === min) return 0.5;
  return (v - min) / (max - min);
}

export interface AxisScale {
  min: number;
  max: number;
}

/** 每维度的值域(过滤非数值);无有效值时返回 {min:0,max:1} */
export function computeAxisScales(
  data: Record<string, unknown>[],
  dimensions: string[],
): Record<string, AxisScale> {
  const out: Record<string, AxisScale> = {};
  for (const dim of dimensions) {
    let min = Infinity;
    let max = -Infinity;
    for (const row of data) {
      const v = row[dim];
      if (typeof v !== 'number' || !Number.isFinite(v)) continue;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    out[dim] = min === Infinity ? { min: 0, max: 1 } : { min, max };
  }
  return out;
}

/** 蓝(#3b82f6)低 → 红(#ef4444)高 线性插值;越界值钳制 */
export function metricColor(v: number, min: number, max: number): string {
  const t = Math.max(0, Math.min(1, normalizeValue(v, min, max)));
  const r = Math.round(0x3b + (0xef - 0x3b) * t);
  const g = Math.round(0x82 + (0x44 - 0x82) * t);
  const b = Math.round(0xf6 + (0x44 - 0xf6) * t);
  return `rgb(${r} ${g} ${b})`;
}

export interface ChartLayout {
  axes: { dim: string; x: number }[];
  plotTop: number;
  plotBottom: number;
  labelWidth: number;
}

/** 折线点:x = 轴 x 位置,y = plotBottom − normalize(v)·plotHeight;非数值返回 NaN 占位 */
export function buildLinePoints(
  row: Record<string, unknown>,
  dimensions: string[],
  scales: Record<string, AxisScale>,
  layout: ChartLayout,
): { x: number; y: number }[] {
  const plotH = layout.plotBottom - layout.plotTop;
  return dimensions.map((dim) => {
    const v = row[dim];
    const axis = layout.axes.find((a) => a.dim === dim);
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      return { x: NaN, y: NaN };
    }
    const s = scales[dim];
    const y = layout.plotBottom - normalizeValue(v, s.min, s.max) * plotH;
    return { x: axis ? axis.x : 0, y };
  });
}

/** 布局:维度名在轴顶,刻度在轴两端,轴在绘图区等距 */
export function buildChartLayout(
  width: number,
  height: number,
  dimensions: string[],
): ChartLayout {
  const labelWidth = 90;
  const padRight = 24;
  // 顶部留出维度名 + max 刻度空间
  const plotTop = 40;
  const plotBottom = height - 28;
  const plotW = Math.max(0, width - labelWidth - padRight);
  const n = dimensions.length;
  const axes = dimensions.map((dim, i) => ({
    dim,
    x: n <= 1 ? labelWidth + plotW / 2 : labelWidth + (i / (n - 1)) * plotW,
  }));
  return { axes, plotTop, plotBottom, labelWidth };
}

/** 折线点数组 → Leafer Path 字符串;NaN 段用 M 分段,全 NaN/空返回 null */
export function pointsToPath(pts: { x: number; y: number }[]): string | null {
  let parts: string[] = [];
  let started = false;
  let prevValid = false;
  for (const p of pts) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) {
      prevValid = false;
      continue;
    }
    if (!started || !prevValid) {
      parts.push(`M ${p.x} ${p.y}`);
      started = true;
    } else {
      parts.push(`L ${p.x} ${p.y}`);
    }
    prevValid = true;
  }
  return started ? parts.join(' ') : null;
}

/**
 * 等高线提取 —— 基于 d3-contour，把网格标量场转成数据空间闭合折线环。
 *
 * d3-contour 输出的坐标在网格索引空间（x∈[0,nCols]，y∈[0,nRows]，格子中心 +0.5，
 * 行序与 z 一致），这里统一线性映射回 α/β 数据空间，供 LandscapeHeatmap 直接叠加。
 */
import { contours } from 'd3-contour';

export interface ContourRing {
  /** 递增环 id（同一条折线 series 内不连别的环） */
  id: number;
  /** 数据空间闭合环顶点 [α, β] */
  points: [number, number][];
  /** 该环对应的等值线阈值 */
  level: number;
}

export function buildContourRings(
  z: ArrayLike<number>,
  nRows: number,
  nCols: number,
  levels: number[],
  xs: ArrayLike<number>,
  ys: ArrayLike<number>,
): ContourRing[] {
  if (nRows < 2 || nCols < 2 || levels.length === 0) return [];

  const values = Float64Array.from(z);
  const generator = contours().size([nCols, nRows]).thresholds(levels);
  const multipolygons = generator(values);

  const x0 = Number(xs[0]);
  const y0 = Number(ys[0]);
  const stepX = nCols > 1 ? (Number(xs[nCols - 1]) - x0) / (nCols - 1) : 0;
  const stepY = nRows > 1 ? (Number(ys[nRows - 1]) - y0) / (nRows - 1) : 0;

  const rings: ContourRing[] = [];
  let id = 0;
  for (const mp of multipolygons) {
    const level = Number(mp.value);
    for (const polygon of mp.coordinates) {
      for (const ring of polygon) {
        const points = ring.map(
          ([u, v]) => [x0 + (u - 0.5) * stepX, y0 + (v - 0.5) * stepY] as [number, number],
        );
        if (points.length >= 4) rings.push({ id: id++, points, level });
      }
    }
  }
  return rings;
}

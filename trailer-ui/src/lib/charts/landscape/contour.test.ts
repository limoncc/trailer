import { describe, it, expect } from 'vitest';
import { buildContourRings } from './contour';
import { linspace } from './landscape';

/** 以 (0,0) 为中心的二维高斯网格。 */
function gaussianGrid(n: number): Float32Array {
  const xs = linspace(-1, 1, n);
  const ys = linspace(-1, 1, n);
  const z = new Float32Array(n * n);
  for (let r = 0; r < n; r++)
    for (let c = 0; c < n; c++) {
      const x = xs[c];
      const y = ys[r];
      z[r * n + c] = Math.exp(-(x * x + y * y) * 4);
    }
  return z;
}

describe('buildContourRings', () => {
  it('extracts ascending nested rings for a gaussian and maps to data space', () => {
    const n = 21;
    const z = gaussianGrid(n);
    const xs = linspace(-1, 1, n);
    const ys = linspace(-1, 1, n);
    const rings = buildContourRings(z, n, n, [0.3, 0.6], xs, ys);

    // 两个阈值各至少一条环
    expect(rings.length).toBeGreaterThanOrEqual(2);
    for (const ring of rings) {
      expect(ring.points.length).toBeGreaterThanOrEqual(4);
      // 数据空间映射：所有点落在网格范围内
      for (const [x, y] of ring.points) {
        expect(x).toBeGreaterThanOrEqual(-1);
        expect(x).toBeLessThanOrEqual(1);
        expect(y).toBeGreaterThanOrEqual(-1);
        expect(y).toBeLessThanOrEqual(1);
      }
    }

    // 更高阈值(0.6)的环应更小：bbox 严格小于 0.3 的最大环
    const bbox = (points: [number, number][]) => ({
      w: Math.max(...points.map((p) => p[0])) - Math.min(...points.map((p) => p[0])),
      h: Math.max(...points.map((p) => p[1])) - Math.min(...points.map((p) => p[1])),
    });
    const inner = rings[rings.length - 1]; // id 递增 → 最后一条来自更高阈值
    const outer = rings[0];
    const bi = bbox(inner.points);
    const bo = bbox(outer.points);
    expect(bi.w).toBeLessThan(bo.w);
    expect(bi.h).toBeLessThan(bo.h);
  });

  it('returns no rings for a flat grid below threshold', () => {
    const n = 4;
    const z = new Float32Array(n * n); // 全 0
    const rings = buildContourRings(z, n, n, [0.5], linspace(0, 1, n), linspace(0, 1, n));
    expect(rings).toEqual([]);
  });

  it('guards degenerate dimensions', () => {
    const z = new Float32Array(2);
    expect(buildContourRings(z, 1, 2, [0.5], linspace(0, 1, 2), linspace(0, 1, 1))).toEqual([]);
  });
});

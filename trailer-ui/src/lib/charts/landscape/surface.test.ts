import { describe, it, expect } from 'vitest';
import { buildSurfaceGeometry, SURFACE_THEME } from './surface';
import { colormap, linspace, type ParsedLandscape } from './landscape';

function makeParsed(nR = 3, nC = 3): ParsedLandscape {
  const z = new Float32Array(nR * nC);
  for (let r = 0; r < nR; r++)
    for (let c = 0; c < nC; c++) z[r * nC + c] = (r * nC + c) as number; // 0..8
  return {
    nRows: nR,
    nCols: nC,
    xRange: [-1, 1],
    yRange: [-1, 1],
    xs: linspace(-1, 1, nC),
    ys: linspace(-1, 1, nR),
    z,
    zmin: 0,
    zmax: nR * nC - 1,
    meta: {},
  };
}

describe('buildSurfaceGeometry', () => {
  it('emits one vertex per grid cell with row-major positions', () => {
    const g = buildSurfaceGeometry(makeParsed());
    expect(g.positions.length).toBe(3 * 3 * 3); // 每顶点 xyz
    expect(g.colors.length).toBe(3 * 3 * 3);
    // 顶点 0 = (xs[0], h(z0), ys[0])
    expect(g.positions[0]).toBeCloseTo(-1); // x = α min
    expect(g.positions[2]).toBeCloseTo(-1); // z = β min
    // 顶点 8 = (xs[2], h(z8), ys[2])
    expect(g.positions[24]).toBeCloseTo(1); // x
    expect(g.positions[26]).toBeCloseTo(1); // z
  });

  it('heights are monotonic in z (normalized 0..hSpan)', () => {
    const g = buildSurfaceGeometry(makeParsed());
    const hOf = (i: number) => g.positions[i * 3 + 1];
    expect(hOf(0)).toBeCloseTo(0); // zmin → 0
    expect(hOf(8)).toBeCloseTo(g.hSpan); // zmax → hSpan
    expect(hOf(4)).toBeGreaterThan(hOf(3));
    expect(hOf(4)).toBeLessThan(hOf(5));
  });

  it('vertex colors follow viridis colormap of normalized z', () => {
    const g = buildSurfaceGeometry(makeParsed());
    // 顶点色为 0-1 归一化，放大 255 与 0-255 LUT 对比
    const cOf = (i: number) => [g.colors[i * 3] * 255, g.colors[i * 3 + 1] * 255, g.colors[i * 3 + 2] * 255];
    expect(cOf(0)[0]).toBeCloseTo(colormap(0)[0], 0);
    expect(cOf(8)[0]).toBeCloseTo(colormap(1)[0], 0);
  });

  it('indices build two triangles per quad', () => {
    const g = buildSurfaceGeometry(makeParsed());
    const quads = (3 - 1) * (3 - 1);
    expect(g.indices.length).toBe(quads * 6);
    // 第一个 quad 引用首行前两个顶点与第二行对应顶点（多重集合比较）
    expect(Array.from(g.indices.slice(0, 6)).sort()).toEqual([0, 3, 1, 1, 3, 4].sort());
  });

  it('throws on empty grid', () => {
    const p = makeParsed();
    p.z = new Float32Array(0);
    expect(() => buildSurfaceGeometry(p)).toThrow();
  });
});

describe('SURFACE_THEME', () => {
  it('has light and dark palettes', () => {
    expect(SURFACE_THEME.light.bg).toBeDefined();
    expect(SURFACE_THEME.dark.bg).toBeDefined();
  });
});

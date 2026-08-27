import { describe, it, expect } from 'vitest';
import {
  parseFigureToLandscape,
  colormap,
  buildContourLevels,
  groupLandscapeFigures,
  COLORMAP_NAMES,
} from './landscape';
import type { LandscapeFigureRow } from './landscape';

const figureRow = (body: string, name = 'll', step = 0): LandscapeFigureRow => ({
  run_id: 'r1',
  step,
  name,
  kind: 'landscape',
  body,
});

describe('parseFigureToLandscape', () => {
  it('parses a valid 3x3 body with row-major z and linspaced axes', () => {
    const body = JSON.stringify({
      v: 1,
      n_rows: 3,
      n_cols: 3,
      x_range: [-1, 1],
      y_range: [0, 2],
      z: [
        [1, 2, 3],
        [4, 5, 6],
        [7, 8, 9],
      ],
      meta: { normalization: 'filter' },
    });
    const out = parseFigureToLandscape(figureRow(body));
    expect(out).not.toBeNull();
    expect(out!.nRows).toBe(3);
    expect(out!.nCols).toBe(3);
    // 行主序展开
    expect(Array.from(out!.z)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(out!.zmin).toBe(1);
    expect(out!.zmax).toBe(9);
    // 轴坐标含端点等距：xs 长度=nCols，ys 长度=nRows
    expect(out!.xs.length).toBe(3);
    expect(out!.ys.length).toBe(3);
    expect(out!.xs[0]).toBeCloseTo(-1);
    expect(out!.xs[2]).toBeCloseTo(1);
    expect(out!.ys[0]).toBeCloseTo(0);
    expect(out!.ys[2]).toBeCloseTo(2);
    expect(out!.meta).toEqual({ normalization: 'filter' });
  });

  it('returns null for invalid JSON', () => {
    expect(parseFigureToLandscape(figureRow('not json'))).toBeNull();
  });

  it('returns null when z dimensions mismatch n_rows', () => {
    const body = JSON.stringify({ n_rows: 3, n_cols: 3, x_range: [0, 1], y_range: [0, 1], z: [[1, 2], [3, 4]] });
    expect(parseFigureToLandscape(figureRow(body))).toBeNull();
  });

  it('returns null when grid edge below 2', () => {
    const body = JSON.stringify({ n_rows: 1, n_cols: 3, x_range: [0, 1], y_range: [0, 1], z: [[1, 2, 3]] });
    expect(parseFigureToLandscape(figureRow(body))).toBeNull();
  });
});

describe('colormap', () => {
  it('viridis: explicit name keeps classic endpoints/anchor', () => {
    expect(colormap(0, 'viridis')).toEqual([68, 1, 84]);
    expect(colormap(0.5, 'viridis')).toEqual([33, 145, 140]);
    expect(colormap(1, 'viridis')).toEqual([253, 231, 37]);
  });

  it('magma: dark → fiery → pale endpoints', () => {
    expect(colormap(0, 'magma')).toEqual([0, 0, 4]);
    expect(colormap(1, 'magma')).toEqual([252, 253, 191]);
  });

  it('plasma: deep blue → yellow endpoints', () => {
    expect(colormap(0, 'plasma')).toEqual([13, 8, 135]);
    expect(colormap(1, 'plasma')).toEqual([240, 249, 33]);
  });

  it('defaults to coolwarm (浅色发散,避免大面积暗黑)', () => {
    expect(colormap(0)).toEqual([59, 76, 192]);
    expect(colormap(1)).toEqual([180, 4, 38]);
  });

  it('coolwarm: bright diverging blue → white → red', () => {
    expect(colormap(0, 'coolwarm')).toEqual([59, 76, 192]);
    expect(colormap(1, 'coolwarm')).toEqual([180, 4, 38]);
    // 中段足够亮(不黑)
    const [r, g, b] = colormap(0.5, 'coolwarm');
    expect(r + g + b).toBeGreaterThan(500);
  });

  it('clamps out-of-range t', () => {
    expect(colormap(-5, 'viridis')).toEqual([68, 1, 84]);
    expect(colormap(42, 'viridis')).toEqual([253, 231, 37]);
  });

  it('covers every registered map with valid rgb triplets', () => {
    for (const name of COLORMAP_NAMES) {
      for (const t of [0, 0.25, 0.5, 0.75, 1]) {
        const [r, g, b] = colormap(t, name);
        expect(r).toBeGreaterThanOrEqual(0);
        expect(r).toBeLessThanOrEqual(255);
        expect(g).toBeGreaterThanOrEqual(0);
        expect(g).toBeLessThanOrEqual(255);
        expect(b).toBeGreaterThanOrEqual(0);
        expect(b).toBeLessThanOrEqual(255);
      }
    }
  });
});

describe('buildContourLevels', () => {
  it('produces k ascending interior levels excluding endpoints', () => {
    const levels = buildContourLevels(0, 10, 2);
    expect(levels).toHaveLength(2);
    expect(levels[0]).toBeGreaterThan(0);
    expect(levels[1]).toBeLessThan(10);
    expect(levels[0]).toBeCloseTo((1 * 10) / 3);
    expect(levels[1]).toBeCloseTo((2 * 10) / 3);
  });

  it('returns empty for degenerate range or k', () => {
    expect(buildContourLevels(5, 5, 3)).toEqual([]);
    expect(buildContourLevels(0, 10, 0)).toEqual([]);
  });
});

describe('groupLandscapeFigures', () => {
  const row = (name: string, step: number): LandscapeFigureRow =>
    figureRow('{}', name, step);

  it('groups by name and sorts rows by step asc', () => {
    const groups = groupLandscapeFigures([row('b', 10), row('a', 5), row('a', 1)]);
    expect(groups.map((g) => g.name)).toEqual(['a', 'b']);
    expect(groups[0].rows.map((r) => r.step)).toEqual([1, 5]);
  });

  it('sorts groups by name', () => {
    const groups = groupLandscapeFigures([row('z', 0), row('a', 0)]);
    expect(groups.map((g) => g.name)).toEqual(['a', 'z']);
  });

  it('returns empty for no rows', () => {
    expect(groupLandscapeFigures([])).toEqual([]);
  });
});

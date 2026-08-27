import { describe, it, expect } from 'vitest';
import {
  parseFigureToLandscape,
  colormap,
  buildContourLevels,
  groupLandscapeFigures,
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

describe('colormap (viridis)', () => {
  it('maps endpoints to viridis first/last anchors', () => {
    expect(colormap(0)).toEqual([68, 1, 84]);
    expect(colormap(1)).toEqual([253, 231, 37]);
  });

  it('hits anchor exactly at midpoint', () => {
    expect(colormap(0.5)).toEqual([33, 145, 140]);
  });

  it('clamps out-of-range t', () => {
    expect(colormap(-5)).toEqual([68, 1, 84]);
    expect(colormap(42)).toEqual([253, 231, 37]);
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

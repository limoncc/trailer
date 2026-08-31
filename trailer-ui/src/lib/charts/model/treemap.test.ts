import { describe, it, expect } from 'vitest';
import { squarify, type TreemapItem } from './treemap';

const items = (values: number[]): TreemapItem[] =>
  values.map((v, i) => ({ id: `c${i}`, label: `c${i}`, value: v }));

function noOverlap(rects: { x: number; y: number; w: number; h: number }[]): boolean {
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i], b = rects[j];
      const sep = a.x + a.w <= b.x + 0.5 || b.x + b.w <= a.x + 0.5 ||
                  a.y + a.h <= b.y + 0.5 || b.y + b.h <= a.y + 0.5;
      if (!sep) return false;
    }
  }
  return true;
}

describe('squarify', () => {
  it('produces proportional, non-overlapping, in-bounds rects', () => {
    const rects = squarify(items([6, 4, 3, 2, 1]), 200, 100);
    const total = 16;
    expect(rects).toHaveLength(5);
    for (const r of rects) {
      expect(r.x).toBeGreaterThanOrEqual(-0.5);
      expect(r.y).toBeGreaterThanOrEqual(-0.5);
      expect(r.x + r.w).toBeLessThanOrEqual(200.5);
      expect(r.y + r.h).toBeLessThanOrEqual(100.5);
      expect(r.w).toBeGreaterThan(0);
      expect(r.h).toBeGreaterThan(0);
    }
    expect(noOverlap(rects)).toBe(true);
    // 面积占比 ≈ 数值占比
    for (const r of rects) {
      const v = [6, 4, 3, 2, 1][Number(r.id.slice(1))];
      const expected = (v / total) * 200 * 100;
      expect(r.w * r.h).toBeGreaterThan(expected * 0.9);
      expect(r.w * r.h).toBeLessThan(expected * 1.1);
    }
  });

  it('keeps rectangles reasonably square (squarified aspect)', () => {
    const rects = squarify(items([53, 31, 7, 7, 7, 7, 3]), 300, 150);
    for (const r of rects) {
      const aspect = Math.max(r.w, r.h) / Math.min(r.w, r.h);
      expect(aspect).toBeLessThan(6); // 远好于顺序条形布局
    }
  });

  it('handles single item and skips zero values', () => {
    const one = squarify(items([10]), 100, 50);
    expect(one).toEqual([{ id: 'c0', x: 0, y: 0, w: 100, h: 50 }]);
    const withZero = squarify(items([10, 0]), 100, 50);
    expect(withZero.map(r => r.id)).toEqual(['c0']);
  });
});

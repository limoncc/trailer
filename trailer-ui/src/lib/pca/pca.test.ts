import { describe, it, expect } from 'vitest';
import { parsePcaBody, groupPcaFigures } from './pca';
import type { PcaFigureRow } from './pcaTypes';

describe('parsePcaBody', () => {
  it('parses valid pca body', () => {
    const body = JSON.stringify({ meta: { n_samples: 2 }, points: [{ x: 0, y: 0, z: 0, cluster: 'A' }] });
    const out = parsePcaBody(body);
    expect(out).not.toBeNull();
    expect(out?.points.length).toBe(1);
  });

  it('returns null for invalid JSON', () => {
    expect(parsePcaBody('not json')).toBeNull();
  });

  it('returns null when points is missing', () => {
    expect(parsePcaBody(JSON.stringify({ meta: {} }))).toBeNull();
  });
});

describe('groupPcaFigures', () => {
  const row = (name: string, step: number): PcaFigureRow => ({
    run_id: 'r1', step, name, kind: 'pca', body: '{}',
  });

  it('groups by name and sorts rows by step asc', () => {
    const groups = groupPcaFigures([row('b', 10), row('a', 5), row('a', 1)]);
    expect(groups.map((g) => g.name)).toEqual(['a', 'b']);
    const a = groups[0];
    expect(a.rows.map((r) => r.step)).toEqual([1, 5]);
  });

  it('sorts groups by name', () => {
    const groups = groupPcaFigures([row('z', 0), row('a', 0)]);
    expect(groups.map((g) => g.name)).toEqual(['a', 'z']);
  });

  it('returns empty for no rows', () => {
    expect(groupPcaFigures([])).toEqual([]);
  });
});

import { describe, it, expect } from 'vitest';
import { WIDGET_TYPES, widgetTypeAvailability, widgetTypesFor } from './widgetTypes';

describe('widgetTypeAvailability', () => {
  it('marks tabs without data unavailable (picker hides empty tabs)', () => {
    const avail = widgetTypeAvailability({
      metrics: 3, config: 0, hists: 5, pca: 0, landscape: 0,
      figures: 0, texts: 0, tables: 0, media: 0,
      runs: 3, summaryKeys: 3,
    });
    expect(avail).toEqual({
      info: true, line: true, hist: true,
      pca: false, landscape: false, figure: false,
      text: false, table: false, media: false,
      scatter: true, 'scatter-pair': true, parallel: true, diff: true, summary: true,
    });
  });

  it('info tab shows when config exists even without metrics', () => {
    const avail = widgetTypeAvailability({
      metrics: 0, config: 4, hists: 0, pca: 0, landscape: 0,
      figures: 0, texts: 0, tables: 0, media: 0,
    });
    expect(avail.info).toBe(true);
    expect(avail.line).toBe(false);
  });

  it('all false on a bare run (explore counters omitted)', () => {
    const avail = widgetTypeAvailability({
      metrics: 0, config: 0, hists: 0, pca: 0, landscape: 0,
      figures: 0, texts: 0, tables: 0, media: 0,
    });
    expect(Object.values(avail).every((v) => !v)).toBe(true);
  });

  it('explore types gate on run/summary counters', () => {
    const counts = {
      metrics: 0, config: 0, hists: 0, pca: 0, landscape: 0,
      figures: 0, texts: 0, tables: 0, media: 0,
    };
    const none = widgetTypeAvailability(counts);
    expect(none.diff).toBe(false);
    expect(none.summary).toBe(false);

    const one = widgetTypeAvailability({ ...counts, runs: 1, summaryKeys: 1 });
    expect(one.summary).toBe(true);
    expect(one['scatter-pair']).toBe(false);
    expect(one.diff).toBe(false);

    const two = widgetTypeAvailability({ ...counts, runs: 2, summaryKeys: 2 });
    expect(two.diff).toBe(true);
    expect(two['scatter-pair']).toBe(true);
  });

  it('scatter needs at least one run', () => {
    const counts = {
      metrics: 0, config: 4, hists: 0, pca: 0, landscape: 0,
      figures: 0, texts: 0, tables: 0, media: 0,
    };
    expect(widgetTypeAvailability(counts).scatter).toBe(false);
    expect(widgetTypeAvailability({ ...counts, runs: 1 }).scatter).toBe(true);
  });
});

describe('WIDGET_TYPES hosts', () => {
  it('registers the five explore types with explore-only hosts', () => {
    for (const type of ['scatter', 'scatter-pair', 'parallel', 'diff', 'summary'] as const) {
      const meta = WIDGET_TYPES.find((t) => t.type === type);
      expect(meta, `missing ${type}`).toBeDefined();
      expect(meta!.hosts).toEqual(['explore']);
      expect(meta!.label.length).toBeGreaterThan(0);
    }
  });

  it('defaults legacy types to boards only and line to both hosts', () => {
    const line = WIDGET_TYPES.find((t) => t.type === 'line');
    expect(line!.hosts).toEqual(['boards', 'explore']);
    for (const type of ['info', 'hist', 'pca', 'landscape', 'figure', 'text', 'table', 'media'] as const) {
      expect(WIDGET_TYPES.find((t) => t.type === type)!.hosts ?? ['boards']).toEqual(['boards']);
    }
  });

  it('widgetTypesFor filters by host', () => {
    expect(widgetTypesFor('boards').map((t) => t.type)).not.toContain('diff');
    expect(widgetTypesFor('explore').map((t) => t.type)).toContain('diff');
    expect(widgetTypesFor('explore').map((t) => t.type)).not.toContain('hist');
  });
});

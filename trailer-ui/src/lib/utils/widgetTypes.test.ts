import { describe, it, expect } from 'vitest';
import { widgetTypeAvailability } from './widgetTypes';

describe('widgetTypeAvailability', () => {
  it('marks tabs without data unavailable (picker hides empty tabs)', () => {
    const avail = widgetTypeAvailability({
      metrics: 3, config: 0, hists: 5, pca: 0, landscape: 0,
      figures: 0, texts: 0, tables: 0, media: 0,
    });
    expect(avail).toEqual({
      info: true, line: true, hist: true,
      pca: false, landscape: false, figure: false,
      text: false, table: false, media: false,
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

  it('all false on a bare run', () => {
    const avail = widgetTypeAvailability({
      metrics: 0, config: 0, hists: 0, pca: 0, landscape: 0,
      figures: 0, texts: 0, tables: 0, media: 0,
    });
    expect(Object.values(avail).every((v) => !v)).toBe(true);
  });
});

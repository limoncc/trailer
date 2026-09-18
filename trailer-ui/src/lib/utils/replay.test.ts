import { describe, it, expect } from 'vitest';
import { dataStepRange, clipMetrics, clipBoardsData, followIndex } from './replay';
import { EMPTY_BOARDS_DATA, type BoardsData, type MetricSeries } from '../components/boards/boardsData';

function series(key: string, steps: number[], context = ''): MetricSeries {
  return { key, context, points: steps.map((step, idx) => ({ step, value: idx, idx })) };
}

const FULL_DATA: BoardsData = {
  ...EMPTY_BOARDS_DATA,
  histograms: [
    { run_id: 'r', step: 5, wall_time: 1, key: 'w', context: 'attn', bucket_limits: [0, 1], bucket_counts: [1, 2], min: 0, max: 1, num: 3, sum: 1, sum_squares: 1 },
    { run_id: 'r', step: 9, wall_time: 2, key: 'w', context: 'attn', bucket_limits: [0, 1], bucket_counts: [2, 1], min: 0, max: 1, num: 3, sum: 1, sum_squares: 1 },
  ],
  figures: [
    { run_id: 'r', step: 2, name: 'img', kind: 'png', body: '' },
    { run_id: 'r', step: 12, name: 'pca1', kind: 'pca', body: '{}' },
  ],
  texts: [{ run_id: 'r', step: 7, name: 'note', body: 'x' }],
  tables: [{ id: 1, run_id: 'r', step: 3, name: 't', columns: [], data: [], row_count: 0 }],
  media: [{ id: 1, run_id: 'r', step: 15, name: 'm', kind: 'image', ext: 'png', size: 1 }],
};

describe('dataStepRange', () => {
  it('returns null range on empty inputs', () => {
    expect(dataStepRange([], EMPTY_BOARDS_DATA)).toBeNull();
  });

  it('spans metrics and all boardsData kinds', () => {
    const range = dataStepRange([series('a', [1, 4]), series('b', [2])], FULL_DATA);
    expect(range).toEqual({ min: 1, max: 15 });
  });

  it('uses boardsData alone when metrics empty', () => {
    expect(dataStepRange([], FULL_DATA)).toEqual({ min: 2, max: 15 });
  });

  it('handles single-step data', () => {
    expect(dataStepRange([series('a', [3])], EMPTY_BOARDS_DATA)).toEqual({ min: 3, max: 3 });
  });
});

describe('clipMetrics', () => {
  it('keeps points with step <= S', () => {
    const m = [series('a', [1, 2, 3]), series('b', [5], 'gpu0')];
    const clipped = clipMetrics(m, 2);
    expect(clipped[0].points.map((p) => p.step)).toEqual([1, 2]);
    expect(clipped[1].points).toEqual([]);
    expect(clipped[0].key).toBe('a');
    expect(clipped[1].context).toBe('gpu0');
  });

  it('returns original reference when nothing clipped (memo-friendly identity)', () => {
    const m = [series('a', [1, 2])];
    expect(clipMetrics(m, 5)).toBe(m);
  });
});

describe('clipBoardsData', () => {
  it('filters every kind by step <= S', () => {
    const clipped = clipBoardsData(FULL_DATA, 7);
    expect(clipped.histograms.map((h) => h.step)).toEqual([5]);
    expect(clipped.figures.map((f) => f.step)).toEqual([2]);
    expect(clipped.texts.map((t) => t.step)).toEqual([7]);
    expect(clipped.tables.map((t) => t.step)).toEqual([3]);
    expect(clipped.media).toEqual([]);
  });

  it('returns original reference when S beyond all steps', () => {
    expect(clipBoardsData(FULL_DATA, 99)).toBe(FULL_DATA);
  });
});

describe('followIndex', () => {
  it('returns index of last step <= follow', () => {
    expect(followIndex([1, 3, 5, 7], 5)).toBe(2);
    expect(followIndex([1, 3, 5, 7], 6)).toBe(2);
    expect(followIndex([1, 3, 5, 7], 99)).toBe(3);
  });

  it('clamps to first index when follow below all steps', () => {
    expect(followIndex([1, 3, 5], 0)).toBe(0);
    expect(followIndex([], 5)).toBe(0);
  });
});

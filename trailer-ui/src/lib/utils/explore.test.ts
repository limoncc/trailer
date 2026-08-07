import { describe, it, expect, vi } from 'vitest';
import {
  parseSummaryKey,
  collectConfigPaths,
  collectSummaryOptions,
  resolveRunScalar,
  buildLineRows,
  buildScalarScatterRows,
  buildPairScatterRows,
  buildParallelData,
  scalarAxisName,
  serializeDefs,
  deserializeDefs,
  loadSeries,
} from './explore';
import type { RunRecord, SeriesData, BatchQuery, ChartDef } from './explore';

const runs: RunRecord[] = [
  {
    run_id: 'r1',
    name: 'a',
    state: 'finished',
    project: 'p1',
    created_at: 1,
    sweep_id: null,
    config: { params: 1e6, model: { depth: 12 }, name: 'gpt2' },
    summary: { 'loss/': { last: 0.5, best: 0.3 }, 'loss/train': { last: 0.4 } },
    owner_id: null,
  },
  {
    run_id: 'r2',
    name: 'b',
    state: 'finished',
    project: 'p2',
    created_at: 2,
    sweep_id: 'sweep-a',
    config: { params: 1e7, model: { depth: 24 } },
    summary: { 'acc/': { last: 0.9 } },
    owner_id: null,
  },
];

describe('parseSummaryKey', () => {
  it('parses empty context (key ending with slash)', () => {
    expect(parseSummaryKey('loss/')).toEqual({ key: 'loss', context: '' });
  });

  it('parses context suffix', () => {
    expect(parseSummaryKey('loss/train')).toEqual({ key: 'loss', context: 'train' });
  });

  it('handles key containing slashes', () => {
    expect(parseSummaryKey('train/loss/')).toEqual({ key: 'train/loss', context: '' });
  });
});

describe('collectConfigPaths', () => {
  it('collects leaf paths including nested', () => {
    const paths = collectConfigPaths(runs);
    expect(paths).toContain('params');
    expect(paths).toContain('model.depth');
    expect(paths).toContain('name');
  });

  it('dedupes across runs', () => {
    const paths = collectConfigPaths(runs);
    expect(paths.filter((p) => p === 'params').length).toBe(1);
  });
});

describe('collectSummaryOptions', () => {
  it('collects unique summary keys across runs', () => {
    const opts = collectSummaryOptions(runs);
    const keys = opts.map((o) => o.summaryKey);
    expect(keys).toContain('loss/');
    expect(keys).toContain('loss/train');
    expect(keys).toContain('acc/');
  });

  it('decodes summary keys to key/context', () => {
    const opts = collectSummaryOptions(runs);
    const lossTrain = opts.find((o) => o.summaryKey === 'loss/train');
    expect(lossTrain).toEqual({ summaryKey: 'loss/train', key: 'loss', context: 'train' });
  });
});

describe('resolveRunScalar', () => {
  const r1 = runs[0];

  it('reads numeric config value by path', () => {
    expect(resolveRunScalar(r1, { kind: 'config', path: 'params' })).toBe(1e6);
  });

  it('reads nested config value', () => {
    expect(resolveRunScalar(r1, { kind: 'config', path: 'model.depth' })).toBe(12);
  });

  it('returns undefined for non-numeric config value', () => {
    expect(resolveRunScalar(r1, { kind: 'config', path: 'name' })).toBeUndefined();
  });

  it('returns undefined for missing config path', () => {
    expect(resolveRunScalar(r1, { kind: 'config', path: 'nope' })).toBeUndefined();
  });

  it('reads summary field', () => {
    expect(resolveRunScalar(r1, { kind: 'summary', summaryKey: 'loss/', field: 'last' })).toBe(0.5);
    expect(resolveRunScalar(r1, { kind: 'summary', summaryKey: 'loss/', field: 'best' })).toBe(0.3);
  });

  it('returns undefined for missing summary key or field', () => {
    expect(resolveRunScalar(r1, { kind: 'summary', summaryKey: 'acc/', field: 'last' })).toBeUndefined();
    expect(resolveRunScalar(r1, { kind: 'summary', summaryKey: 'loss/', field: 'max' })).toBeUndefined();
  });
});

describe('chart data builders', () => {
  const series: SeriesData = new Map([
    [
      'r1',
      [
        {
          run_id: 'r1',
          key: 'loss',
          context: '',
          points: [
            { step: 0, wall_time: 100, value: 1.0, idx: 0 },
            { step: 1, wall_time: 200, value: 0.5, idx: 1 },
          ],
        },
        {
          run_id: 'r1',
          key: 'acc',
          context: '',
          points: [
            { step: 0, wall_time: 100, value: 0.1, idx: 0 },
            { step: 1, wall_time: 200, value: 0.8, idx: 1 },
          ],
        },
      ],
    ],
    [
      'r2',
      [
        {
          run_id: 'r2',
          key: 'loss',
          context: '',
          points: [{ step: 0, wall_time: 150, value: 2.0, idx: 0 }],
        },
      ],
    ],
  ]);

  it('buildLineRows expands points with color value injected', () => {
    const { rows, colorField } = buildLineRows(runs, [{ key: 'loss', context: '' }], { kind: 'run' }, series);
    expect(colorField).toBe('_series');
    expect(rows.length).toBe(3);
    expect(rows[0]).toMatchObject({ step: 0, value: 1.0, run_id: 'r1', _series: 'r1 | loss' });
    expect(rows[2]).toMatchObject({ step: 0, value: 2.0, run_id: 'r2', _series: 'r2 | loss' });
  });

  it('buildLineRows skips runs missing the metric', () => {
    const { rows } = buildLineRows(runs, [{ key: 'acc', context: '' }], { kind: 'run' }, series);
    // 只有 r1 有 acc → 2 个点;r2 无 acc 被跳过
    expect(rows.length).toBe(2);
  });

  it('buildLineRows supports multiple metrics', () => {
    const { rows } = buildLineRows(
      runs,
      [
        { key: 'loss', context: '' },
        { key: 'acc', context: '' },
      ],
      { kind: 'run' },
      series,
    );
    // loss: r1 2点 + r2 1点;acc: r1 2点(r2 无) → 5 行
    expect(rows.length).toBe(5);
    const seriesVals = [...new Set(rows.map((r) => r._series))].sort();
    expect(seriesVals).toEqual(['r1 | acc', 'r1 | loss', 'r2 | loss']);
  });

  it('buildScalarScatterRows gives one point per run (scaling law)', () => {
    const { rows, colorField } = buildScalarScatterRows(
      runs,
      { kind: 'config', path: 'params' },
      { kind: 'summary', summaryKey: 'loss/', field: 'last' },
      { kind: 'project' },
    );
    expect(colorField).toBe('project');
    // r1 有 params + loss/;r2 缺 loss/ → 跳过
    expect(rows.length).toBe(1);
    expect(rows[0]).toMatchObject({ x: 1e6, y: 0.5, project: 'p1' });
  });

  it('buildPairScatterRows inner-joins two metrics by step', () => {
    const { rows } = buildPairScatterRows(
      runs,
      { key: 'loss', context: '' },
      { key: 'acc', context: '' },
      { kind: 'run' },
      series,
    );
    // r1: (1.0,0.1) 和 (0.5,0.8);r2 无 acc → 0
    expect(rows.length).toBe(2);
    expect(rows[0]).toMatchObject({ x: 1.0, y: 0.1 });
    expect(rows[1]).toMatchObject({ x: 0.5, y: 0.8 });
  });

  it('buildParallelData gives one row per run with safe dim columns', () => {
    const { rows, dimensions } = buildParallelData(runs, [
      { kind: 'config', path: 'params' },
      { kind: 'summary', summaryKey: 'loss/', field: 'last' },
    ]);
    // 点号转 __,避免 G2 当嵌套路径
    expect(dimensions).toEqual(['cfg__params', 'loss__last']);
    // r1 有 params + loss/;r2 缺 loss/ → 跳过
    expect(rows.length).toBe(1);
    expect(rows[0]).toMatchObject({ run_id: 'r1', cfg__params: 1e6, loss__last: 0.5 });
  });

  it('scalarAxisName decodes summary keys', () => {
    expect(scalarAxisName({ kind: 'summary', summaryKey: 'loss/train', field: 'best' })).toBe('train/loss.best');
    expect(scalarAxisName({ kind: 'config', path: 'model.depth' })).toBe('cfg.model.depth');
  });

  it('serializeDefs/deserializeDefs roundtrip chart defs', () => {
    const defs: ChartDef[] = [
      { type: 'line', x: { kind: 'step' }, metrics: [{ key: 'loss', context: '' }], color: { kind: 'run' }, yLog: true },
      { type: 'scatter', x: { kind: 'config', path: 'params' }, y: { kind: 'summary', summaryKey: 'loss/', field: 'last' }, color: { kind: 'project' } },
    ];
    const s = serializeDefs(defs);
    expect(s.length).toBeGreaterThan(0);
    const back = deserializeDefs(s);
    expect(back).toEqual(defs);
  });

  it('deserializeDefs migrates legacy single metric to metrics', () => {
    const legacy = [{ type: 'line', x: { kind: 'step' }, metric: { key: 'loss', context: '' }, color: { kind: 'run' } }];
    const s = btoa(encodeURIComponent(JSON.stringify(legacy)));
    const back = deserializeDefs(s);
    expect(back?.[0]).toMatchObject({ type: 'line', metrics: [{ key: 'loss', context: '' }] });
    expect((back?.[0] as any).metric).toBeUndefined();
  });

  it('deserializeDefs returns null on invalid input', () => {
    expect(deserializeDefs('not-base64!!!')).toBeNull();
    expect(deserializeDefs(btoa('not json'))).toBeNull();
    expect(deserializeDefs(btoa('{}'))).toBeNull();
  });

  it('loadSeries fetches missing metrics once and caches', async () => {
    const cache: SeriesData = new Map();
    const fetcher = vi.fn(async (queries: BatchQuery[]) =>
      queries.map((q) => ({
        run_id: q.run_id,
        key: q.key,
        context: q.context,
        points: [{ step: 0, wall_time: 1, value: 1, idx: 0 }],
      })),
    );
    await loadSeries(cache, runs, [{ key: 'loss', context: '' }], 500, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(cache.get('r1')?.length).toBe(1);
    // 第二次调用,数据已缓存,不再请求
    await loadSeries(cache, runs, [{ key: 'loss', context: '' }], 500, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

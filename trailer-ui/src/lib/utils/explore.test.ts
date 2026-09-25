import { describe, it, expect, vi } from 'vitest';
import {
  parseSummaryKey,
  collectConfigPaths,
  collectSummaryOptions,
  resolveRunScalar,
  buildScalarScatterRows,
  buildPairScatterRows,
  buildParallelData,
  scalarAxisName,
  loadSeries,
  refreshSeriesIncremental,
} from './explore';
import type { RunRecord, SeriesData, BatchQuery } from './explore';

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
  // 不变量:写入侧 parse_key_context 按最后一个 '/' 拆分,存储层 key 永不含 '/';
  // API 拼接串 "key/context" 的第一个 '/' 即边界 → 任意层数斜杠的 context 精确可逆
  it('parses empty context (key ending with slash)', () => {
    expect(parseSummaryKey('loss/')).toEqual({ key: 'loss', context: '' });
  });

  it('parses context suffix', () => {
    expect(parseSummaryKey('loss/train')).toEqual({ key: 'loss', context: 'train' });
  });

  it('parses multi-slash context (eval nested)', () => {
    expect(parseSummaryKey('sr_d2/eval/train')).toEqual({ key: 'sr_d2', context: 'eval/train' });
  });

  it('parses four-level context', () => {
    expect(parseSummaryKey('m/a/b/c/d')).toEqual({ key: 'm', context: 'a/b/c/d' });
  });

  it('parses composite with empty key', () => {
    expect(parseSummaryKey('/train/loss')).toEqual({ key: '', context: 'train/loss' });
  });

  it('parses bare key without slash', () => {
    expect(parseSummaryKey('loss')).toEqual({ key: 'loss', context: '' });
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

  // 原始 bug 回归:context 含斜杠(eval/train)时按最后一个 '/' 切分会解错,
  // 导致 Explore 选 eval 指标后 batch-query 查 0 行、不出图
  it('decodes slash contexts and aligns with series groups (regression)', () => {
    const evalRuns: RunRecord[] = [
      {
        run_id: 'e1',
        name: 'eval run',
        state: 'running',
        project: 'p1',
        created_at: 3,
        sweep_id: null,
        config: {},
        summary: { 'sr_d2/eval/train': { last: 0.29 }, 'loss/': { last: 0.5 } },
        owner_id: null,
      },
    ];
    const evalSeries: SeriesData = new Map([
      [
        'e1',
        [
          {
            run_id: 'e1',
            key: 'sr_d2',
            context: 'eval/train',
            points: [
              { step: 0, wall_time: 1, value: 0.1, idx: 0 },
              { step: 20, wall_time: 2, value: 0.2, idx: 1 },
            ],
          },
        ],
      ],
    ]);
    const opts = collectSummaryOptions(evalRuns);
    const sr = opts.find((o) => o.key === 'sr_d2');
    expect(sr).toEqual({ summaryKey: 'sr_d2/eval/train', key: 'sr_d2', context: 'eval/train' });
    // 与 series 组精确对齐(key/context 同源解析,batch-query 才查得到行)
    const group = evalSeries.get('e1')!.find((g) => g.key === sr!.key && g.context === sr!.context);
    expect(group).toBeDefined();
    expect(group!.points).toHaveLength(2);
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

describe('refreshSeriesIncremental', () => {
  const metric = { key: 'loss', context: '' };
  const group = (points: Array<[number, number]>) => ({
    run_id: 'r1',
    key: 'loss',
    context: '',
    points: points.map(([step, value], i) => ({ step, wall_time: step, value, idx: i })),
  });

  it('queries cached groups only, with after_step = their max step', async () => {
    const cache: SeriesData = new Map([['r1', [group([[0, 1], [10, 0.5]])]]]);
    const fetcher = vi.fn(async (qs: BatchQuery[]) =>
      qs.map((q) => ({ run_id: q.run_id, key: q.key, context: q.context, points: [] })),
    );
    await refreshSeriesIncremental(cache, runs, [metric], 500, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const qs = fetcher.mock.calls[0][0];
    expect(qs).toHaveLength(1);
    expect(qs[0]).toMatchObject({ run_id: 'r1', key: 'loss', context: '' });
    expect(qs[0].after_step).toBe(10);
  });

  it('skips groups the cache does not hold yet (full load owns them)', async () => {
    const cache: SeriesData = new Map([['r1', [group([[0, 1]])]]]);
    const fetcher = vi.fn(async (_qs: BatchQuery[]) => []);
    await refreshSeriesIncremental(cache, runs, [metric, { key: 'acc', context: '' }], 500, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toHaveLength(1);
    expect(fetcher.mock.calls[0][0][0].key).toBe('loss');
  });

  it('merges by step, deduping the full re-send of system metrics', async () => {
    const cache: SeriesData = new Map([['r1', [group([[0, 1], [10, 0.5]])]]]);
    // system 指标后端忽略 after_step 全量回 → 去重后只并入新 step
    const fetcher = vi.fn(async (qs: BatchQuery[]) =>
      qs.map((q) => ({
        run_id: q.run_id,
        key: q.key,
        context: q.context,
        points: [
          { step: 0, wall_time: 0, value: 1, idx: 0 },
          { step: 10, wall_time: 10, value: 0.5, idx: 1 },
          { step: 20, wall_time: 20, value: 0.25, idx: 2 },
        ],
      })),
    );
    await refreshSeriesIncremental(cache, runs, [metric], 500, fetcher);
    const points = cache.get('r1')![0].points;
    expect(points.map((p) => p.step)).toEqual([0, 10, 20]);
    expect(points[2].value).toBe(0.25);
  });

  it('does nothing when there is nothing cached to refresh', async () => {
    const cache: SeriesData = new Map();
    const fetcher = vi.fn(async (_qs: BatchQuery[]) => []);
    await refreshSeriesIncremental(cache, runs, [metric], 500, fetcher);
    expect(fetcher).not.toHaveBeenCalled();
    expect(cache.size).toBe(0);
  });
});

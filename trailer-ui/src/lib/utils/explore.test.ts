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
  healChartDefs,
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
  it('decodes slash contexts and matches series end-to-end (regression)', () => {
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
    const { rows } = buildLineRows(evalRuns, [sr!], { kind: 'run' }, evalSeries);
    expect(rows.length).toBe(2);
    expect(rows[0]).toMatchObject({ step: 0, value: 0.1, run_id: 'e1', _series: 'e1 | eval/train/sr_d2' });
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

describe('healChartDefs', () => {
  // 旧版 parseSummaryKey 按最后一个 '/' 切分,保存的 MetricRef key 会吞进 context 前缀。
  // 合法 key 永不含 '/',凡 key 含 '/' 的按首斜杠重切修复
  it('heals line/scatter-pair MetricRefs saved with the legacy wrong split', () => {
    const defs: ChartDef[] = [
      {
        type: 'line',
        x: { kind: 'step' },
        metrics: [
          { key: 'sr_d2/eval', context: 'train' },
          { key: 'loss', context: '' },
        ],
        color: { kind: 'run' },
      },
      {
        type: 'scatter-pair',
        x: { kind: 'metric', metric: { key: 'sr/eval', context: 'test' } },
        y: { kind: 'metric', metric: { key: 'loss', context: 'train' } },
        color: { kind: 'run' },
      },
    ];
    const healed = healChartDefs(defs);
    expect((healed[0] as Extract<ChartDef, { type: 'line' }>).metrics).toEqual([
      { key: 'sr_d2', context: 'eval/train' },
      { key: 'loss', context: '' },
    ]);
    const pair = healed[1] as Extract<ChartDef, { type: 'scatter-pair' }>;
    expect(pair.x.metric).toEqual({ key: 'sr', context: 'eval/test' });
    expect(pair.y.metric).toEqual({ key: 'loss', context: 'train' });
  });

  it('leaves summary axes, colors and configs untouched', () => {
    const defs: ChartDef[] = [
      {
        type: 'scatter',
        x: { kind: 'summary', summaryKey: 'sr_d2/eval/train', field: 'last' },
        y: { kind: 'config', path: 'params' },
        color: { kind: 'summary', summaryKey: 'loss/train', field: 'best' },
      },
      { type: 'parallel', dims: [{ kind: 'summary', summaryKey: 'acc/', field: 'max' }] },
    ];
    expect(healChartDefs(defs)).toEqual(defs);
  });

  it('does not mutate the input defs', () => {
    const defs: ChartDef[] = [
      { type: 'line', x: { kind: 'step' }, metrics: [{ key: 'sr_d2/eval', context: 'train' }], color: { kind: 'run' } },
    ];
    healChartDefs(defs);
    expect((defs[0] as Extract<ChartDef, { type: 'line' }>).metrics[0]).toEqual({
      key: 'sr_d2/eval',
      context: 'train',
    });
  });

  it('deserializeDefs heals legacy defs from saved explores / share URLs', () => {
    const legacy = [
      { type: 'line', x: { kind: 'step' }, metrics: [{ key: 'sr_d2/eval', context: 'train' }], color: { kind: 'run' } },
    ];
    const back = deserializeDefs(btoa(encodeURIComponent(JSON.stringify(legacy))));
    expect((back?.[0] as Extract<ChartDef, { type: 'line' }>).metrics).toEqual([
      { key: 'sr_d2', context: 'eval/train' },
    ]);
  });
});


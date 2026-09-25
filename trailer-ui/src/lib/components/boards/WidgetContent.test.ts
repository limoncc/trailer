import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@antv/g2', () => {
  const mockOptions = vi.fn();
  const mockChart = { options: mockOptions, render: vi.fn(), destroy: vi.fn(), on: vi.fn(), emit: vi.fn() };
  return { Chart: vi.fn().mockImplementation(() => mockChart) };
});

import { mount, unmount, tick } from 'svelte';
import WidgetContent from './WidgetContent.svelte';
import { EMPTY_BOARDS_DATA, type MetricSeries } from './boardsData';
import { PALETTE, type ExploreCtx } from '$lib/utils/exploreWidgets';
import type { DashWidget } from '$lib/utils/dashboard';
import type { RunRecord } from '$lib/utils/explore';

function run(id: string, config: Record<string, unknown> = {}): RunRecord {
  return {
    run_id: id,
    name: null,
    state: 'finished',
    project: 'p1',
    created_at: 1,
    sweep_id: null,
    config,
    summary: { 'loss/': { last: 0.5, best: 0.4, min: 0.3, max: 1 } },
    owner_id: null,
  };
}

const runs = [run('r1', { lr: 0.1 }), run('r2', { lr: 0.2 })];

function makeCtx(overrides: Partial<ExploreCtx> = {}): ExploreCtx {
  return {
    runs,
    labelOf: (id) => (id === 'r1' ? 'alpha' : id === 'r2' ? 'beta' : id.slice(0, 12)),
    colorValueOf: (r) => r.run_id,
    colorOfValue: (cv) => (cv === 'r1' ? PALETTE[0] : cv === 'r2' ? PALETTE[1] : PALETTE[2]),
    isRunning: () => false,
    series: new Map(),
    ...overrides,
  };
}

const points = [
  { step: 0, value: 1, idx: 0, wall_time: 100 },
  { step: 1, value: 0.5, idx: 1, wall_time: 101 },
];

function metricSeries(runId?: string): MetricSeries[] {
  return [{ key: 'loss', context: '', points, ...(runId ? { run_id: runId } : {}) }];
}

async function mountContent(widget: DashWidget, opts: { metrics?: MetricSeries[]; explore?: ExploreCtx } = {}) {
  const target = document.createElement('div');
  document.body.appendChild(target);
  const component = mount(WidgetContent, {
    target,
    props: {
      widget,
      runId: 'r1',
      metrics: opts.metrics ?? metricSeries(),
      data: EMPTY_BOARDS_DATA,
      heightPx: 200,
      ...(opts.explore ? { explore: opts.explore } : {}),
    },
  });
  await tick();
  await tick();
  return { target, component };
}

/** 取最后一次 chart.options() 的参数 */
async function lastSpec() {
  const { Chart } = await import('@antv/g2');
  const instances = vi.mocked(Chart).mock.results;
  const chart = instances.at(-1)?.value as { options: ReturnType<typeof vi.fn> };
  const calls = chart.options.mock.calls;
  return calls.at(-1)?.[0] as Record<string, never> | undefined;
}

const lineWidget = (over: Partial<Extract<DashWidget, { type: 'line' }>> = {}): DashWidget => ({
  id: 'w1',
  type: 'line',
  metrics: [{ key: 'loss', context: '' }],
  w: 12,
  h: 4,
  ...over,
});

describe('WidgetContent line — Boards path (no explore ctx)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('keeps single-run series naming and metric-order palette', async () => {
    const { target, component } = await mountContent(lineWidget());
    const spec = await lastSpec();
    const rows = spec!.data as Array<{ series: string }>;
    expect([...new Set(rows.map((r) => r.series))]).toEqual(['loss']);
    const range = (spec!.scale as unknown as { color: { range: string[] } }).color.range;
    expect(range[0]).toBe(PALETTE[0]);
    unmount(component);
    target.remove();
  });

  it('passes logX through to the chart', async () => {
    const { target, component } = await mountContent(lineWidget({ xLog: true }));
    const spec = await lastSpec();
    expect((spec!.scale as unknown as { x: { type?: string } }).x.type).toBe('log');
    unmount(component);
    target.remove();
  });

  it('keeps the legend off for Boards callers', async () => {
    const { target, component } = await mountContent(lineWidget());
    const spec = await lastSpec();
    expect(spec!.legend).toBe(false);
    unmount(component);
    target.remove();
  });
});

describe('WidgetContent line — explore legend', () => {
  beforeEach(() => vi.clearAllMocks());

  it('turns the legend on under explore ctx', async () => {
    const { target, component } = await mountContent(lineWidget(), {
      metrics: [...metricSeries('r1'), ...metricSeries('r2')],
      explore: makeCtx(),
    });
    const spec = await lastSpec();
    expect(spec!.legend).toMatchObject({ position: 'top' });
    unmount(component);
    target.remove();
  });
});

describe('WidgetContent line — explore (multi run)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('names one series per run and colours each run from the stable map', async () => {
    const { target, component } = await mountContent(lineWidget(), {
      metrics: [...metricSeries('r1'), ...metricSeries('r2')],
      explore: makeCtx(),
    });
    const spec = await lastSpec();
    const rows = spec!.data as Array<{ series: string }>;
    expect([...new Set(rows.map((r) => r.series))].sort()).toEqual(['alpha | loss', 'beta | loss']);
    const range = (spec!.scale as unknown as { color: { range: string[] } }).color.range;
    expect(range.slice(0, 2)).toEqual([PALETTE[0], PALETTE[1]]);
    unmount(component);
    target.remove();
  });

  it('keeps remaining series colours when one run is hidden', async () => {
    const { target, component } = await mountContent(lineWidget(), {
      metrics: metricSeries('r2'),
      explore: makeCtx(),
    });
    const spec = await lastSpec();
    const range = (spec!.scale as unknown as { color: { range: string[] } }).color.range;
    expect(range[0]).toBe(PALETTE[1]);
    unmount(component);
    target.remove();
  });

  it('expands smooth into a raw/solid pair sharing one run colour', async () => {
    const { target, component } = await mountContent(lineWidget({ smooth: 3 }), {
      metrics: [...metricSeries('r1'), ...metricSeries('r2')],
      explore: makeCtx(),
    });
    const spec = await lastSpec();
    const rows = spec!.data as Array<{ series: string }>;
    expect([...new Set(rows.map((r) => r.series))].sort()).toEqual([
      'alpha | loss__raw',
      'alpha | loss__smooth',
      'beta | loss__raw',
      'beta | loss__smooth',
    ]);
    const range = (spec!.scale as unknown as { color: { range: string[] } }).color.range;
    expect(range).toEqual([`${PALETTE[0]}40`, PALETTE[0], `${PALETTE[1]}40`, PALETTE[1]]);
    unmount(component);
    target.remove();
  });
});

describe('WidgetContent diff / summary cards', () => {
  beforeEach(() => vi.clearAllMocks());

  const diffWidget: DashWidget = { id: 'd1', type: 'diff', w: 12, h: 6 };

  it('shows an empty hint when fewer than two runs are visible', async () => {
    const { target, component } = await mountContent(diffWidget, { explore: makeCtx({ runs: [runs[0]] }) });
    expect(target.textContent).toContain('Select 2+ runs');
    unmount(component);
    target.remove();
  });

  it('lists differing config keys as rows', async () => {
    const { target, component } = await mountContent(diffWidget, { explore: makeCtx() });
    const text = target.textContent ?? '';
    expect(text).toContain('lr');
    expect(text).toContain('0.1');
    expect(text).toContain('0.2');
    unmount(component);
    target.remove();
  });

  it('says so when configs are identical', async () => {
    const twin = [run('r1', { lr: 0.1 }), run('r2', { lr: 0.1 })];
    const { target, component } = await mountContent(diffWidget, { explore: makeCtx({ runs: twin }) });
    expect(target.textContent).toContain('No config differences');
    unmount(component);
    target.remove();
  });

  it('summary card renders four stat columns per metric', async () => {
    const summaryWidget: DashWidget = { id: 's1', type: 'summary', w: 18, h: 6 };
    const partial = run('r3', {});
    partial.summary = { 'loss/': { last: 0.25 } }; // 缺 best/min/max → 渲染为 —
    const { target, component } = await mountContent(summaryWidget, {
      explore: makeCtx({ runs: [runs[0], partial] }),
    });
    const text = target.textContent ?? '';
    for (const col of ['Last', 'Best', 'Min', 'Max']) expect(text).toContain(col);
    expect(text).toContain('0.500'); // last=0.5 → toPrecision(4)
    expect(text).toContain('—');
    unmount(component);
    target.remove();
  });
});

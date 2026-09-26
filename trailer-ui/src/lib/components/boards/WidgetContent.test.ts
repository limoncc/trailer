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
    // 键是 "<run>|<context>/<key>" 组合键;按 run 前缀给稳定色,其余落到第三色
    colorOfValue: (k) => (k.startsWith('r1') ? PALETTE[0] : k.startsWith('r2') ? PALETTE[1] : PALETTE[2]),
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

/** hover 系列按钮展开浮层(实现是 JS hover + fixed 定位) */
async function openSeriesPanel(target: HTMLElement) {
  const btn = target.querySelector('[data-series-toggle] button') as HTMLElement | null;
  if (btn) {
    btn.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }));
    await tick();
    await tick();
  }
}

async function mountContent(
  widget: DashWidget,
  opts: { metrics?: MetricSeries[]; explore?: ExploreCtx; onSmoothChange?: (v: number) => void } = {}
) {
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
      ...(opts.onSmoothChange ? { onSmoothChange: opts.onSmoothChange } : {}),
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

  it('renders no series table for Boards callers (single run, unchanged layout)', async () => {
    const { target, component } = await mountContent(lineWidget());
    expect(target.querySelector('[data-series-row]')).toBeNull();
    unmount(component);
    target.remove();
  });

  it('keeps the default 1.5px lineWidth for Boards callers', async () => {
    const { target, component } = await mountContent(lineWidget());
    const spec = await lastSpec();
    expect((spec!.style as { lineWidth?: number }).lineWidth).toBe(1.5);
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

describe('WidgetContent line — no legend under explore ctx', () => {
  beforeEach(() => vi.clearAllMocks());

  it('keeps the legend off; run names ride in the tooltip series instead', async () => {
    const { target, component } = await mountContent(lineWidget(), {
      metrics: [...metricSeries('r1'), ...metricSeries('r2')],
      explore: makeCtx(),
    });
    const spec = await lastSpec();
    expect(spec!.legend).toBeFalsy();
    // 系列名仍是 "<run> | <metric>",tooltip 用它区分是哪条线
    const rows = spec!.data as Array<{ series: string }>;
    // 系列名结构:<run>/<context>/<key>(context 为空时 <run>/<key>)
    expect([...new Set(rows.map((r) => r.series))].sort()).toEqual(['alpha/loss', 'beta/loss']);
    unmount(component);
    target.remove();
  });
});

describe('WidgetContent line — explore (multi run)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('names one series per run as <run>/<key> and colours by (run, metric) key', async () => {
    const asked: string[] = [];
    const { target, component } = await mountContent(lineWidget(), {
      metrics: [...metricSeries('r1'), ...metricSeries('r2')],
      explore: makeCtx({
        colorOfValue: (k) => {
          asked.push(k);
          return k.startsWith('r1') ? PALETTE[0] : PALETTE[1];
        },
      }),
    });
    const spec = await lastSpec();
    const rows = spec!.data as Array<{ series: string }>;
    expect([...new Set(rows.map((r) => r.series))].sort()).toEqual(['alpha/loss', 'beta/loss']);
    // 配色键是组合键:同 run 的不同指标不会挤到同一种颜色
    expect([...new Set(asked)].sort()).toEqual(['r1|loss', 'r2|loss']);
    const range = (spec!.scale as unknown as { color: { range: string[] } }).color.range;
    expect(range.slice(0, 2)).toEqual([PALETTE[0], PALETTE[1]]);
    unmount(component);
    target.remove();
  });

  it('draws only runs the metric run_ids checked (勾选细化到 run)', async () => {
    const { target, component } = await mountContent(lineWidget({ metrics: [
      { key: 'loss', context: '', run_ids: ['r1'] },
    ] }), {
      metrics: [...metricSeries('r1'), ...metricSeries('r2')],
      explore: makeCtx(),
    });
    const spec = await lastSpec();
    const rows = spec!.data as Array<{ series: string }>;
    // r2 的数据在缓存里,但该 metric 只勾了 r1 → 只画 r1 的线
    expect([...new Set(rows.map((r) => r.series))]).toEqual(['alpha/loss']);
    // 色槽也不给未勾 run(与 lineSeriesKeys 同源)
    const range = (spec!.scale as unknown as { color: { range: string[] } }).color.range;
    expect(range[0]).toBe(PALETTE[0]);
    unmount(component);
    target.remove();
  });

  it('gives two metrics of the SAME run two colours (previously both took the run colour)', async () => {
    const { target, component } = await mountContent(lineWidget({ metrics: [
      { key: 'loss', context: 'train' },
      { key: 'acc', context: 'train' },
    ] }), {
      metrics: [
        { key: 'loss', context: 'train', points: metricSeries()[0].points, run_id: 'r1' },
        { key: 'acc', context: 'train', points: metricSeries()[0].points, run_id: 'r1' },
      ],
      // 色键含指标段:同 run 两条线拿到不同的键 → 不同色;若键退化成 run_id 就会同色而失败
      explore: makeCtx({ colorOfValue: (k) => (k.includes('loss') ? PALETTE[0] : PALETTE[1]) }),
    });
    const spec = await lastSpec();
    const rows = spec!.data as Array<{ series: string }>;
    expect([...new Set(rows.map((r) => r.series))].sort()).toEqual(['alpha/train/acc', 'alpha/train/loss']);
    // range 按 G2 domain(系列名字母序)对齐:acc 在前
    const range = (spec!.scale as unknown as { color: { range: string[] } }).color.range;
    expect(range).toEqual([PALETTE[1], PALETTE[0]]);
    unmount(component);
    target.remove();
  });

  it('renders a table-style series list above the chart (colour dot + run/context/key, rule between rows)', async () => {
    const { target, component } = await mountContent(lineWidget({ metrics: [
      { key: 'loss', context: 'train' },
    ] }), {
      metrics: [
        { key: 'loss', context: 'train', points: metricSeries()[0].points, run_id: 'r1' },
        { key: 'loss', context: 'train', points: metricSeries()[0].points, run_id: 'r2' },
      ],
      explore: makeCtx(),
    });
    await openSeriesPanel(target);
    // 层级树:层1 = run 分组标题,层2 = 缩进的 context/指标 行
    const groups = [...target.querySelectorAll('[data-series-group]')];
    const gtexts = groups.map((g) => (g.textContent ?? '').replace(/\s+/g, ' ').trim());
    expect(gtexts).toHaveLength(2);
    // 组头 = run 名 + 该组可见/总数
    expect(gtexts[0]).toContain('alpha');
    expect(gtexts[1]).toContain('beta');
    expect(gtexts[0]).toContain('1/1');
    const rows = [...target.querySelectorAll('[data-series-row]')];
    expect(rows.length).toBe(2);
    // 层2 显示 context/指标(带层级)
    expect(rows.map((r) => (r.querySelector('[data-series-leaf]')?.textContent ?? '').trim())).toEqual([
      'train/loss',
      'train/loss',
    ]);
    // 每行带色点(颜色与曲线同源)与分隔线
    for (const row of rows) {
      const dot = row.querySelector('[data-series-dot]') as HTMLElement;
      expect(dot).toBeTruthy();
      expect(dot.style.background).toMatch(/^rgb|^#/);
      expect(row.classList.contains('border-b')).toBe(true);
    }
    // 表头
    const table = target.querySelector('[data-series-table]') as HTMLElement;
    expect(table.getAttribute('data-has-head')).toBe('true');
    const btn = target.querySelector('[data-series-toggle]') as HTMLElement;
    expect(btn).toBeTruthy();
    expect(btn.textContent ?? '').toContain('2'); // 系列数
    // 定位在**内容容器**内(容器 relative),top-6 让开 y 轴刻度,不压标题栏
    // 绘图区顶部空白行(1.8 刻度上方那条带),x 再右一截避开 y 轴刻度列
    expect(btn.className).toContain('top-1');
    expect(btn.className).toContain('left-16');
    // 尺寸与右上角 Smooth/Select/Exclude 工具条按钮一致
    const inner = btn.querySelector('button') as HTMLElement;
    expect(inner.className).toContain('px-1.5');
    expect(inner.className).toContain('py-0.5');
    expect(inner.className).toContain('text-[10px]');
    const content = btn.closest('[data-series-anchor]') as HTMLElement;
    expect(content).toBeTruthy();
    expect(content.className).toContain('relative');
    // fixed 定位:不被卡片 overflow-hidden 裁剪("点开看不到东西"的根因)。
    // jsdom 不加载 Tailwind 层叠表 → 断言 class + 内联坐标,而非 computed style
    const panel = target.querySelector('[data-series-panel]') as HTMLElement;
    expect(panel).toBeTruthy();
    expect(panel.className).toContain('fixed');
    expect(panel.style.left).toBeTruthy();
    expect(panel.style.top).toBeTruthy();
    // 半透明 + 背景模糊:展开时不把下方曲线完全挡死
    const panelCard = panel.querySelector('div') as HTMLElement;
    expect(panelCard.className).toContain('bg-card/75');
    expect(panelCard.className).toContain('backdrop-blur');
    unmount(component);
    target.remove();
  });

  it('groups leaves under a run header as context/metric (true hierarchy)', async () => {
    const { target, component } = await mountContent(lineWidget({ metrics: [
      { key: 'loss', context: 'train/s1_seq32k' },
      { key: 'loss', context: 'train/s2_seq64k' },
    ] }), {
      metrics: [
        { key: 'loss', context: 'train/s1_seq32k', points: metricSeries()[0].points, run_id: 'r1' },
        { key: 'loss', context: 'train/s2_seq64k', points: metricSeries()[0].points, run_id: 'r1' },
      ],
      explore: makeCtx(),
    });
    await openSeriesPanel(target);
    // 同一个 run 只有一个组头,两个缩进叶子 context/指标 —— 不再是一整行斜杠串
    const groups = [...target.querySelectorAll('[data-series-group]')];
    expect(groups.length).toBe(1);
    expect((groups[0].textContent ?? '').replace(/\s+/g, ' ').trim()).toContain('alpha');
    const leaves = [...target.querySelectorAll('[data-series-leaf]')].map((l) => (l.textContent ?? '').trim());
    expect(leaves).toEqual(['train/s1_seq32k/loss', 'train/s2_seq64k/loss']);
    unmount(component);
    target.remove();
  });

  it('wires the smooth quick-toggle: on → 5, off → 0 (persisted via widget.smooth)', async () => {
    const onSmoothChange = vi.fn();
    const { target, component } = await mountContent(lineWidget(), {
      explore: makeCtx(),
      onSmoothChange,
    });
    const btn = [...target.querySelectorAll('button')].find((b) => (b.textContent ?? '').includes('Smooth'));
    expect(btn).toBeTruthy();
    btn!.click();
    expect(onSmoothChange).toHaveBeenLastCalledWith(5); // off → 默认窗口 5
    unmount(component);
    target.remove();
  });

  it('shows no smooth button for Boards (no handler wired)', async () => {
    const { target, component } = await mountContent(lineWidget());
    const btn = [...target.querySelectorAll('button')].find((b) => (b.textContent ?? '').includes('Smooth'));
    expect(btn).toBeUndefined();
    unmount(component);
    target.remove();
  });

  it('diff table is transposed: header = config keys, rows = run names', async () => {
    const { target, component } = await mountContent({ id: 'd9', type: 'diff', w: 12, h: 6 }, {
      explore: makeCtx(),
    });
    const table = target.querySelector('table');
    expect(table).toBeTruthy();
    const head = [...table!.querySelectorAll('thead th')].map((th) => (th.textContent ?? '').trim());
    // 首列表头 = Run,其后是差异的 config 键(列 = 指标/config)
    expect(head[0]).toBe('Run');
    expect(head).toContain('lr');
    expect(head).not.toContain('alpha'); // run 名不在表头(在行首列)
    // 行 = run 名
    const rowLabels = [...table!.querySelectorAll('tbody tr')].map(
      (tr) => (tr.querySelector('td')?.textContent ?? '').trim()
    );
    expect(rowLabels).toEqual(['alpha', 'beta']);
    unmount(component);
    target.remove();
  });

  it('lists only series the chart actually draws (skips empty (run, metric) combos)', async () => {
    const { target, component } = await mountContent(lineWidget({ metrics: [
      { key: 'loss', context: 'train' },
      { key: 'acc', context: 'train' },
    ] }), {
      metrics: [
        // 只有 r1 有 loss;r2 的 acc 是空组合(无点)
        { key: 'loss', context: 'train', points: metricSeries()[0].points, run_id: 'r1' },
        { key: 'acc', context: 'train', points: [], run_id: 'r2' },
      ],
      explore: makeCtx(),
    });
    await openSeriesPanel(target);
    const groups = [...target.querySelectorAll('[data-series-group]')];
    const leaves = [...target.querySelectorAll('[data-series-leaf]')].map((l) => (l.textContent ?? '').trim());
    expect(groups.length).toBe(1); // 只有 r1 组(r2 全是空组合)
    expect(leaves).toEqual(['train/loss']);
    unmount(component);
    target.remove();
  });

  it('clicking a row filters that series out of the chart, clicking back restores it', async () => {
    const { target, component } = await mountContent(lineWidget({ metrics: [
      { key: 'loss', context: 'train' },
    ] }), {
      metrics: [
        { key: 'loss', context: 'train', points: metricSeries()[0].points, run_id: 'r1' },
        { key: 'loss', context: 'train', points: metricSeries()[0].points, run_id: 'r2' },
      ],
      explore: makeCtx(),
    });
    // hover 打开浮层才能点到行
    const toggle = target.querySelector('[data-series-toggle] button') as HTMLElement;
    toggle.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }));
    await tick();
    await tick();
    // 初始两条线
    let spec = await lastSpec();
    let rows = spec!.data as Array<{ series: string }>;
    expect([...new Set(rows.map((r) => r.series))].sort()).toEqual(['alpha/train/loss', 'beta/train/loss']);
    // 点掉 alpha 行
    const row0 = target.querySelectorAll('[data-series-row]')[0];
    row0.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await tick();
    await tick();
    spec = await lastSpec();
    rows = spec!.data as Array<{ series: string }>;
    expect([...new Set(rows.map((r) => r.series))]).toEqual(['beta/train/loss']);
    // 行保留但标记 hidden(否则没法点回来)
    const row0Again = target.querySelectorAll('[data-series-row]')[0];
    expect(row0Again.getAttribute('data-series-hidden')).toBe('true');
    // 再点恢复
    row0Again.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await tick();
    await tick();
    spec = await lastSpec();
    rows = spec!.data as Array<{ series: string }>;
    expect([...new Set(rows.map((r) => r.series))].sort()).toEqual(['alpha/train/loss', 'beta/train/loss']);
    unmount(component);
    target.remove();
  });

  it('draws explore lines thicker (2px) for overlap readability', async () => {
    const { target, component } = await mountContent(lineWidget(), {
      metrics: [...metricSeries('r1'), ...metricSeries('r2')],
      explore: makeCtx(),
    });
    const spec = await lastSpec();
    expect((spec!.style as { lineWidth?: number }).lineWidth).toBe(2);
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
      'alpha/loss__raw',
      'alpha/loss__smooth',
      'beta/loss__raw',
      'beta/loss__smooth',
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

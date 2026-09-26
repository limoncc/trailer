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
  opts: {
    metrics?: MetricSeries[];
    explore?: ExploreCtx;
    onSmoothChange?: (v: number) => void;
    onTitleChange?: (t: string) => void;
  } = {}
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
      ...(opts.onTitleChange ? { onTitleChange: opts.onTitleChange } : {}),
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

  it('draws NOTHING for a metric with zero checked runs (默认不勾)', async () => {
    const { target, component } = await mountContent(lineWidget({ metrics: [
      { key: 'loss', context: '', run_ids: [] },
    ] }), {
      metrics: [...metricSeries('r1'), ...metricSeries('r2')],
      explore: makeCtx(),
    });
    const spec = await lastSpec();
    const rows = (spec!.data ?? []) as Array<{ series: string }>;
    // 勾了指标但一个 run 都没挑 → 全过滤,无线
    expect([...new Set(rows.map((r) => r.series))]).toEqual([]);
    // 系列清单也没有(没有真实画出的系列)
    await openSeriesPanel(target);
    expect(target.querySelectorAll('[data-series-row]').length).toBe(0);
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

  it('two runs sharing one display name render distinct series (each_key_duplicate regression)', async () => {
    // run.name 相同、run_id 不同(如 minirl_grpo_cell_b2_seed0 起了两次):
    // 旧代码 label/系列名完全相同 → seriesGroups 合并成一组、组内 (s.name) 撞 key → Widget failed to render
    const { target, component } = await mountContent(lineWidget(), {
      metrics: [...metricSeries('r1'), ...metricSeries('r2')],
      explore: makeCtx({ labelOf: () => 'same-name' }),
    });
    await openSeriesPanel(target);
    // 组头按 run 拆开(label 消歧),各带 run_id 短码
    const groups = [...target.querySelectorAll('[data-series-group]')];
    expect(groups.length).toBe(2);
    const heads = groups.map((g) => g.getAttribute('title') ?? (g.textContent ?? ''));
    expect(heads[0]).not.toBe(heads[1]);
    // 系列名唯一(G2 domain 与 each key 都依赖它)
    const spec = await lastSpec();
    const series = [...new Set((spec!.data as Array<{ series: string }>).map((d) => d.series))];
    expect(series.length).toBe(2);
    // 两组各一条叶子
    expect(target.querySelectorAll('[data-series-row]').length).toBe(2);
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

  it('diff card lists one key per row with a run card each (键行卡流)', async () => {
    const { target, component } = await mountContent({ id: 'd9', type: 'diff', w: 12, h: 6 }, {
      explore: makeCtx(),
    });
    const card = target.querySelector('[data-diff-card]') as HTMLElement;
    expect(card).toBeTruthy();
    // 一个 config 键一行
    const keyRows = [...card.querySelectorAll('[data-diff-key-row]')] as HTMLElement[];
    expect(keyRows.map((r) => r.getAttribute('data-path'))).toContain('lr');
    // 行内每 run 一张卡:run 名在卡头,值/序号在卡内;旧矩阵表头不存在
    const cards = [...card.querySelectorAll('[data-diff-run-card]')] as HTMLElement[];
    expect(cards.length).toBeGreaterThanOrEqual(2); // 2 runs × N keys
    expect(card.textContent).toContain('alpha');
    expect(card.textContent).toContain('beta');
    expect(card.querySelector('[data-diff-corner]')).toBeNull();
    expect(card.querySelector('[data-diff-col]')).toBeNull();
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

  it('summary card: stat segmented control, matrix columns, value formatting', async () => {
    const summaryWidget: DashWidget = { id: 's1', type: 'summary', w: 18, h: 6 };
    const partial = run('r3', {});
    partial.summary = { 'loss/': { last: 0.25 } }; // 缺 best/min/max → 渲染为 —
    const { target, component } = await mountContent(summaryWidget, {
      explore: makeCtx({ runs: [runs[0], partial] }),
    });
    // 矩阵:列 = 指标(列头带方向箭头),行 = run;无指标胶囊 tabs
    expect(target.querySelectorAll('[data-summary-metric-tab]').length).toBe(0);
    expect(target.querySelectorAll('[data-matrix-row]').length).toBe(2);
    expect(target.querySelector('[data-matrix-btn="loss/"]')).toBeTruthy();
    // 单按钮双职责:每指标列头一个(stat 图标 + 方向字符)
    const btns = [...target.querySelectorAll('[data-matrix-btn]')];
    expect(btns.length).toBeGreaterThanOrEqual(1);
    // 默认口径 last:r1 last=0.5 → 0.5000;partial last=0.25 → 0.2500
    const cellTexts = () => [...target.querySelectorAll('[data-matrix-cell]')].map((c) => (c.textContent ?? '').trim());
    expect(cellTexts()).toContain('0.5000');
    expect(cellTexts()).toContain('0.2500');
    // 单击(延迟 220ms)循环:last → min → r1 min=0.3000
    btns[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await tick();
    await new Promise((r) => setTimeout(r, 250));
    expect(cellTexts()).toContain('0.3000');
    unmount(component);
    target.remove();
  });
});

// ─── Diff/Summary 可视化重设计:条形对比 / 着色矩阵 ───

describe('WidgetContent summary matrix visualization', () => {
  beforeEach(() => vi.clearAllMocks());

  const summaryW: DashWidget = { id: 'sv', type: 'summary', w: 18, h: 6 };

  function statRun(id: string, loss: number | undefined, extra: Record<string, { best: number }> = {}) {
    const r = run(id, {});
    const summary: Record<string, { best: number }> = { ...extra };
    // 全口径同值 → rank/热力行为与口径无关(默认 last 也能测)
    if (loss !== undefined) summary['loss/'] = { best: loss, last: loss, min: loss, max: loss } as never;
    r.summary = summary;
    return r;
  }

  function rowsOf(target: HTMLElement): HTMLElement[] {
    return [...target.querySelectorAll('[data-matrix-row]')] as HTMLElement[];
  }

  it('best cell gets a white dot; rows sorted by avg rank ascending', async () => {
    const { target, component } = await mountContent(summaryW, {
      explore: makeCtx({ runs: [statRun('r1', 0.4), statRun('r2', 0.1)] }),
    });
    // loss 列(lower):r2 最优 → 排第一,avg 1.0 ★;r1 第二 2.0
    const rows = rowsOf(target);
    expect(rows.map((r) => r.getAttribute('data-run-id'))).toEqual(['r2', 'r1']);
    const bestCell = rows[0].querySelector('[data-matrix-cell]') as HTMLElement;
    expect(bestCell.getAttribute('data-best')).toBe('true');
    expect(bestCell.querySelector('[data-matrix-best]')).toBeTruthy();
    // 综合 = 依据指标(初始=最后一个)的名次,非加总
    expect((rows[0].querySelector('td:last-child')?.textContent ?? '')).toContain('1');
    expect((rows[0].querySelector('td:last-child')?.textContent ?? '')).toContain('★');
    expect((rows[1].querySelector('td:last-child')?.textContent ?? '')).not.toContain('★');
    expect(rows[1].querySelector('[data-matrix-best]')).toBeNull();
    unmount(component);
    target.remove();
  });

  it('cells tint with primary colour (deeper = better)', async () => {
    const { target, component } = await mountContent(summaryW, {
      explore: makeCtx({ runs: [statRun('r1', 0.4), statRun('r2', 0.1)] }),
    });
    const cells = [...target.querySelectorAll('[data-matrix-cell]')] as HTMLElement[];
    expect(cells).toHaveLength(2);
    expect(cells[0].style.background).toContain('color-mix');
    expect(cells[1].style.background).toContain('color-mix');
    // r2 最优(t=1)与 r1 最差(t=0)底色深浅不同
    expect(cells[0].style.background).not.toBe(cells[1].style.background);
    unmount(component);
    target.remove();
  });

  it('flipping the column direction arrow re-ranks rows and moves the dot', async () => {
    const { target, component } = await mountContent(summaryW, {
      explore: makeCtx({ runs: [statRun('r1', 0.4), statRun('r2', 0.1)] }),
    });
    const dirBtn = target.querySelector('[data-matrix-btn="loss/"]') as HTMLElement;
    expect(dirBtn.textContent).toContain('↓');
    // 双击 = 翻转方向
    dirBtn.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await tick();
    const btn2 = target.querySelector('[data-matrix-btn="loss/"]') as HTMLElement;
    expect(btn2.textContent).toContain('↑');
    expect(btn2.getAttribute('data-lower')).toBe('false');
    const rows = rowsOf(target);
    expect(rows.map((r) => r.getAttribute('data-run-id'))).toEqual(['r1', 'r2']);
    expect(rows[0].querySelector('[data-matrix-best]')).toBeTruthy();
    expect(rows[1].querySelector('[data-matrix-best]')).toBeNull();
    unmount(component);
    target.remove();
  });

  it('column arrows reflect the per-metric direction heuristic (loss↓ acc↑)', async () => {
    const { target, component } = await mountContent(summaryW, {
      explore: makeCtx({
        runs: [
          statRun('r1', 0.5, { 'acc/': { best: 0.9 } }),
          statRun('r2', 0.1, { 'acc/': { best: 0.7 } }),
        ],
      }),
    });
    expect((target.querySelector('[data-matrix-btn="loss/"]') as HTMLElement).textContent).toContain('↓');
    expect((target.querySelector('[data-matrix-btn="acc/"]') as HTMLElement).textContent).toContain('↑');
    unmount(component);
    target.remove();
  });

  it('Rank follows the last-touched metric (初始=最后指标,点谁听谁的)', async () => {
    const { target, component } = await mountContent(summaryW, {
      explore: makeCtx({
        runs: [
          statRun('r1', 0.5, { 'acc/': { best: 0.9 } }),
          statRun('r2', 0.1, { 'acc/': { best: 0.7 } }),
        ],
      }),
    });
    // metrics 并集序 [acc/, loss/];初始依据 = 最后一个(loss,lower)→ r2 最优排前
    let rows = rowsOf(target);
    expect(target.querySelector('[data-matrix-btn="loss/"]')?.getAttribute('data-ref')).toBe('true');
    expect(rows.map((r) => r.getAttribute('data-run-id'))).toEqual(['r2', 'r1']);
    // 单击 acc 列按钮 → acc 成为综合依据(upper:r1 0.9 最优)→ 行序翻转
    const accBtn = target.querySelector('[data-matrix-btn="acc/"]') as HTMLElement;
    accBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await tick();
    await new Promise((r) => setTimeout(r, 250));
    expect(target.querySelector('[data-matrix-btn="acc/"]')?.getAttribute('data-ref')).toBe('true');
    expect(target.querySelector('[data-matrix-btn="loss/"]')?.getAttribute('data-ref')).toBe('false');
    rows = rowsOf(target);
    expect(rows.map((r) => r.getAttribute('data-run-id'))).toEqual(['r1', 'r2']);
    unmount(component);
    target.remove();
  });

  it('in-card title row renames the widget via onTitleChange (persisted)', async () => {
    const onTitleChange = vi.fn();
    const { target, component } = await mountContent(summaryW, {
      explore: makeCtx({ runs: [statRun('r1', 0.4)] }),
      onTitleChange,
    });
    const titleBtn = target.querySelector('[data-summary-title] button') as HTMLElement;
    expect(titleBtn).toBeTruthy();
    expect(titleBtn.textContent).toContain('Summary'); // defaultWidgetTitle
    // 单击进入编辑 → 输入 → Enter 提交
    titleBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await tick();
    const input = target.querySelector('[data-summary-title-input]') as HTMLInputElement;
    expect(input).toBeTruthy();
    input.value = 'My KPI Board';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await tick();
    expect(onTitleChange).toHaveBeenCalledWith('My KPI Board');
    unmount(component);
    target.remove();
  });

  it('missing value shows em dash and sinks to the bottom', async () => {
    const { target, component } = await mountContent(summaryW, {
      explore: makeCtx({ runs: [statRun('r1', 0.4), statRun('r2', undefined)] }),
    });
    const rows = rowsOf(target);
    expect(rows[1].getAttribute('data-run-id')).toBe('r2');
    const cells = [...rows[1].querySelectorAll('[data-matrix-cell]')] as HTMLElement[];
    expect((cells[0].textContent ?? '').trim()).toBe('—');
    expect(cells[0].style.background).toContain('muted'); // 无值 = 素底(不进热力色阶)
    unmount(component);
    target.remove();
  });

  it('all-equal column marks every cell best (tied)', async () => {
    const { target, component } = await mountContent(summaryW, {
      explore: makeCtx({ runs: [statRun('r1', 0.7), statRun('r2', 0.7)] }),
    });
    const cells = [...target.querySelectorAll('[data-matrix-cell]')] as HTMLElement[];
    expect(cells.every((c) => c.getAttribute('data-best') === 'true')).toBe(true);
    expect(cells.every((c) => c.querySelector('[data-matrix-best]'))).toBe(true);
    unmount(component);
    target.remove();
  });

  it('keeps empty hint when runs have no summary', async () => {
    const bare = run('r1', {});
    bare.summary = {}; // run() 默认带 loss/ → 显式清空
    const { target, component } = await mountContent(summaryW, {
      explore: makeCtx({ runs: [bare] }),
    });
    expect(target.textContent).toContain('Runs have no summary yet');
    unmount(component);
    target.remove();
  });

  it('merges same-key metrics across contexts into one column (latest context wins)', async () => {
    // 同一个 loss、不同训练阶段 context → 合并成一列,列头不再出现一排重复的 train/loss
    const r1 = run('r1', {});
    r1.summary = {
      'loss/train/s1_seq32k': { last: 0.9, best: 0.9, min: 0.9, max: 0.9 },
      'loss/train/s2_seq256k_20b': { last: 0.5, best: 0.5, min: 0.5, max: 0.5 },
    };
    const r2 = run('r2', {});
    r2.summary = { 'loss/train/s1_seq32k': { last: 0.7, best: 0.7, min: 0.7, max: 0.7 } };
    const mergedW: DashWidget = {
      id: 'sm',
      type: 'summary',
      w: 18,
      h: 6,
      metrics: [
        { key: 'loss', context: 'train/s1_seq32k' },
        { key: 'loss', context: 'train/s2_seq256k_20b' },
      ],
    };
    const { target, component } = await mountContent(mergedW, {
      explore: makeCtx({ runs: [r1, r2] }),
    });
    expect(target.querySelectorAll('[data-matrix-btn]').length).toBe(1); // 两列 → 一列
    const rows = rowsOf(target);
    // r1 两阶段都有值 → 取最靠后 s2=0.5;r2 只有 s1 → 0.7;loss(lower) → 0.5 排前
    expect(rows.map((r) => r.getAttribute('data-run-id'))).toEqual(['r1', 'r2']);
    const cells = rows.map((r) => (r.querySelector('[data-matrix-cell]')?.textContent ?? '').trim());
    expect(cells).toEqual(['0.5000', '0.7000']);
    unmount(component);
    target.remove();
  });
});

describe('WidgetContent diff visualization', () => {
  beforeEach(() => vi.clearAllMocks());

  it('same-value key row gets a same flag; differing key gets diff', async () => {
    const r1 = run('r1', { lr: 0.1, depth: 12 });
    const r2 = run('r2', { lr: 0.1, depth: 24 });
    const { target, component } = await mountContent(
      { id: 'dv', type: 'diff', w: 12, h: 6, paths: ['lr', 'depth'] },
      { explore: makeCtx({ runs: [r1, r2] }) }
    );
    const rows = [...target.querySelectorAll('[data-diff-key-row]')] as HTMLElement[];
    const lrRow = rows.find((r) => r.getAttribute('data-path') === 'lr')!;
    const depthRow = rows.find((r) => r.getAttribute('data-path') === 'depth')!;
    expect(lrRow.getAttribute('data-same')).toBe('true');
    expect(lrRow.querySelector('[data-diff-flag]')?.textContent).toContain('same');
    expect(depthRow.getAttribute('data-same')).toBe('false');
    expect(depthRow.querySelector('[data-diff-flag]')?.textContent).toContain('diff');
    unmount(component);
    target.remove();
  });
  it('run cards carry the run colour, (none) shows em-dash delta, click re-bases the row', async () => {
    const rs = [run('r1', { depth: 12 }), run('r2', { depth: 24 }), run('r3', { depth: 12 }), run('r4', {})];
    const { target, component } = await mountContent(
      { id: 'dv2', type: 'diff', w: 12, h: 6 },
      { explore: makeCtx({ runs: rs }) }
    );
    const row = target.querySelector('[data-diff-key-row][data-path="depth"]') as HTMLElement;
    let cards = [...row.querySelectorAll('[data-diff-run-card]')] as HTMLElement[];
    expect(cards.length).toBe(4);
    // 色点 = 各自 run 色(非空),序号 1..4
    for (const [i, c] of cards.entries()) {
      expect((c.querySelector('[style*="background"]') as HTMLElement).style.background).toBeTruthy();
      expect(c.textContent).toContain(String(i + 1));
    }
    // (none) 卡:值原样、Δ 无法计算
    expect((cards[3].textContent ?? '')).toContain('(none)');
    expect(cards[3].textContent).toContain('Δ —');
    // 默认 base = r1(第一张):r2 相对 12 → +100.0%
    expect(cards[0].getAttribute('data-base')).toBe('true');
    expect(cards[1].textContent).toContain('Δ +100.0%');
    // 点击 r2 卡 → 它成为 base,r1 变 Δ -50.0%
    cards[1].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await tick();
    cards = [...row.querySelectorAll('[data-diff-run-card]')] as HTMLElement[];
    expect(cards[1].getAttribute('data-base')).toBe('true');
    expect(cards[0].getAttribute('data-base')).toBe('false');
    expect(cards[0].textContent).toContain('Δ -50.0%');
    unmount(component);
    target.remove();
  });
});

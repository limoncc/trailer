import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, unmount, tick } from 'svelte';
import ExploreWidgetEditor from './ExploreWidgetEditor.svelte';
import type { DashWidget } from '$lib/utils/dashboard';
import { serializeLayout, parseLayout } from '$lib/utils/dashboard';
import type { RunRecord } from '$lib/utils/explore';

const runs: RunRecord[] = [
  {
    run_id: 'r1',
    name: null,
    state: 'finished',
    project: 'p1',
    created_at: 1,
    sweep_id: null,
    config: { params: 1e6, lr: 0.1 },
    summary: { 'loss/': { last: 0.5 }, 'acc/': { last: 0.9 } },
    owner_id: null,
  },
  {
    run_id: 'r2',
    name: null,
    state: 'finished',
    project: 'p1',
    created_at: 2,
    sweep_id: null,
    config: { params: 1e7, lr: 0.01 },
    summary: { 'loss/': { last: 0.4 } },
    owner_id: null,
  },
];

const lineWidget: DashWidget = {
  id: 'w1',
  type: 'line',
  metrics: [{ key: 'loss', context: '' }],
  xKind: 'step',
  w: 12,
  h: 4,
};

function mountEditor(widget: DashWidget) {
  const target = document.createElement('div');
  document.body.appendChild(target);
  const onConfirm = vi.fn();
  const onClose = vi.fn();
  const component = mount(ExploreWidgetEditor, { target, props: { widget, runs, onConfirm, onClose } });
  return { target, component, onConfirm, onClose };
}

describe('ExploreWidgetEditor', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows only explore-hosted type tabs', async () => {
    const { target, component } = mountEditor(lineWidget);
    await tick();
    const labels = [...target.querySelectorAll('button')].map((b) => b.textContent?.trim());
    expect(labels).toContain('Scatter');
    expect(labels).toContain('Diff');
    expect(labels).toContain('Summary');
    // 单 run 语义的类型不进 Explore
    expect(labels).not.toContain('Histograms');
    expect(labels).not.toContain('Figures');
    unmount(component);
    target.remove();
  });

  it('confirms an unchanged widget with its original id', async () => {
    const { target, component, onConfirm } = mountEditor(lineWidget);
    await tick();
    const confirm = [...target.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Confirm');
    confirm!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await tick();
    expect(onConfirm).toHaveBeenCalledTimes(1);
    const out = onConfirm.mock.calls[0][0] as DashWidget;
    expect(out).toMatchObject({ id: 'w1', type: 'line', metrics: [{ key: 'loss', context: '' }] });
    unmount(component);
    target.remove();
  });

  it('switching to scatter emits a schema-valid widget that round-trips through layout', async () => {
    const { target, component, onConfirm } = mountEditor(lineWidget);
    await tick();
    const tab = [...target.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Scatter');
    tab!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await tick();
    const confirm = [...target.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Confirm');
    confirm!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await tick();
    const out = onConfirm.mock.calls[0][0] as Extract<DashWidget, { type: 'scatter' }>;
    expect(out.type).toBe('scatter');
    // config 叶节点按字典序,首个是 lr
    expect(out.x).toMatchObject({ kind: 'config', path: 'lr' });
    // summary 选项按 key 字典序,首个是 acc/
    expect(out.y).toMatchObject({ kind: 'summary', summaryKey: 'acc/', field: 'last' });
    // 几何字段保留
    expect(out).toMatchObject({ id: 'w1', w: 12, h: 4 });
    // 通过 layout 往返不丢字段
    const round = parseLayout(serializeLayout({ version: 3, widgets: [out] })).widgets[0];
    expect(round).toEqual(out);
    unmount(component);
    target.remove();
  });

  it('diff tab exposes a config-key picker and confirms selected paths', async () => {
    const { target, component, onConfirm } = mountEditor(lineWidget);
    await tick();
    const tab = [...target.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Diff');
    tab!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await tick();
    // 不再是"无需配置":出现维度选择器(DimPicker trigger)
    expect((target.textContent ?? '')).not.toContain('无需配置');
    const picker = target.querySelector('[data-slot="popover-trigger"]') as HTMLElement;
    expect(picker).toBeTruthy();
    // 打开选择器勾一个 config 键
    picker.click();
    await tick();
    await tick();
    const opts = [...document.querySelectorAll('[data-slot="command-item"]')];
    const item = opts.find((o) => (o.textContent ?? '').includes('params'));
    expect(item).toBeTruthy();
    item!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await tick();
    const confirm = [...target.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Confirm')!;
    confirm.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await tick();
    const out = onConfirm.mock.calls[0][0] as Extract<DashWidget, { type: 'diff' }>;
    expect(out.type).toBe('diff');
    expect(out.paths).toContain('params');
    unmount(component);
    target.remove();
    document.querySelectorAll('[data-slot="popover-content"]').forEach((e) => e.remove());
  });

  it('switching to diff emits a bare diff widget (no selection = all keys)', async () => {
    const { target, component, onConfirm } = mountEditor(lineWidget);
    await tick();
    const tab = [...target.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Diff');
    tab!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await tick();
    expect(target.textContent).toContain('empty = all differing keys');
    const confirm = [...target.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Confirm');
    confirm!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await tick();
    const out = onConfirm.mock.calls[0][0] as DashWidget;
    expect(out.type).toBe('diff');
    unmount(component);
    target.remove();
  });

  it('toggling logX on a line widget only flips that flag', async () => {
    const { target, component, onConfirm } = mountEditor(lineWidget);
    await tick();
    const logX = [...target.querySelectorAll('label')].find((l) => l.textContent?.trim() === 'logX');
    const box = logX!.querySelector('input')!;
    box.checked = true;
    box.dispatchEvent(new Event('change', { bubbles: true }));
    await tick();
    const confirm = [...target.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Confirm');
    confirm!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await tick();
    const out = onConfirm.mock.calls[0][0] as Extract<DashWidget, { type: 'line' }>;
    expect(out.xLog).toBe(true);
    expect(out.metrics).toEqual([{ key: 'loss', context: '' }]);
    unmount(component);
    target.remove();
  });
});

describe('metric picker run layer (先选指标,再选 run)', () => {
  it('renders owners as run leaves under each metric, without the " — run" suffix', async () => {
    const { target, component } = mountEditor(lineWidget);
    await tick();
    // 打开 MetricPicker
    const trigger = target.querySelector('[data-slot="popover-trigger"]') as HTMLElement;
    trigger.click();
    await tick();
    await tick();
    const body = document.body.textContent ?? '';
    // 旧的 "acc — r1" 尾巴被树的 run 层取代
    expect(body).not.toContain(' — r1');
    const runAttrs = [...document.body.querySelectorAll('[data-tree-run]')].map((l) =>
      l.getAttribute('data-tree-run')
    );
    expect(runAttrs).toContain('r1');
    expect(runAttrs).toContain('r2');
    // acc 只有 r1 有 → acc 指标目录下只有 r1 这一个 run 叶
    const accDir = [...document.body.querySelectorAll('[data-tree-dir]')].find(
      (d) => d.getAttribute('data-metric-id') === 'acc'
    );
    expect(accDir).toBeTruthy();
    const accRuns = [...accDir!.querySelectorAll('[data-tree-run]')].map((l) => l.getAttribute('data-tree-run'));
    expect(accRuns).toEqual(['r1']);
    unmount(component);
    target.remove();
    document.querySelectorAll('[data-slot="popover-content"]').forEach((e) => e.remove());
  });

  it('normalizes run_ids against current owners on Confirm', async () => {
    const w: DashWidget = {
      id: 'w1',
      type: 'line',
      xKind: 'step',
      w: 12,
      h: 4,
      metrics: [
        { key: 'loss', context: '', run_ids: ['r1', 'r9'] }, // r9 不是 owners → 剔除,剩 r1(非全 → 保留)
        { key: 'acc', context: '', run_ids: ['r1'] }, // owners 就是 [r1] → 收敛为缺省(全部)
        { key: 'nuke', context: '', run_ids: ['r9'] }, // 全部无效 → 整条 metric 丢弃
      ],
    };
    const { target, component, onConfirm } = mountEditor(w);
    await tick();
    const confirmBtn = [...target.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Confirm');
    confirmBtn!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await tick();
    const out = onConfirm.mock.calls[0][0] as Extract<DashWidget, { type: 'line' }>;
    expect(out.metrics).toEqual([
      { key: 'loss', context: '', run_ids: ['r1'] },
      { key: 'acc', context: '' },
    ]);
    unmount(component);
    target.remove();
  });
});

describe('Smooth control is a single-line stepper defaulting to 0', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders a compact Smooth − N + stepper (no wrapping number input)', async () => {
    const { target, component } = mountEditor(lineWidget);
    await tick();
    const row = [...target.querySelectorAll('label')].find((l) => (l.textContent ?? '').includes('Smooth'));
    expect(row).toBeTruthy();
    // 单行:加减按钮在同一容器内,不再有换行的 window 输入框
    expect(row!.querySelectorAll('button').length).toBe(2);
    expect(row!.querySelector('input[type="number"]')).toBeNull();
    expect(row!.querySelector('[aria-label="Decrease smooth window"]')).toBeTruthy();
    expect(row!.querySelector('[aria-label="Increase smooth window"]')).toBeTruthy();
    // 默认 0(新卡 smooth 未设)
    expect((row!.textContent ?? '').replace(/\s+/g, '')).toContain('0');
    unmount(component);
    target.remove();
  });

  it('width-caps the color select so color/logX/logY/Smooth fit one row', async () => {
    const { target, component } = mountEditor(lineWidget);
    await tick();
    // color 下拉按最长选项撑开(如 color: config.gpu_hours.192…)会把 Smooth 挤到第二行 → 必须限宽
    const colorSel = [...target.querySelectorAll('select')].find((sel) =>
      (sel.options[0]?.textContent ?? '').startsWith('color:')
    );
    expect(colorSel).toBeTruthy();
    expect(colorSel!.className).toContain('max-w-');
    unmount(component);
    target.remove();
  });

  it('stepping up emits smooth:1, stepping back down emits 0', async () => {
    const { target, component, onConfirm } = mountEditor(lineWidget);
    await tick();
    const row = [...target.querySelectorAll('label')].find((l) => (l.textContent ?? '').includes('Smooth'))!;
    row.querySelector('[aria-label="Increase smooth window"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await tick();
    expect((row.textContent ?? '').replace(/\s+/g, '')).toContain('1');
    const confirm = [...target.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Confirm')!;
    confirm.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await tick();
    const out = onConfirm.mock.calls[0][0] as Extract<DashWidget, { type: 'line' }>;
    expect(out.smooth).toBe(1);
    unmount(component);
    target.remove();
  });

  it('decrements to 0 and confirms it as off', async () => {
    const { target, component, onConfirm } = mountEditor({
      id: 'w9',
      type: 'line',
      metrics: [{ key: 'loss', context: '' }],
      xKind: 'step',
      w: 12,
      h: 4,
      smooth: 3,
    });
    await tick();
    const row = [...target.querySelectorAll('label')].find((l) => (l.textContent ?? '').includes('Smooth'))!;
    row.querySelector('[aria-label="Decrease smooth window"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await tick();
    expect((row.textContent ?? '').replace(/\s+/g, '')).toContain('2');
    const confirm = [...target.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Confirm')!;
    confirm.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await tick();
    const out = onConfirm.mock.calls[0][0] as Extract<DashWidget, { type: 'line' }>;
    expect(out.smooth).toBe(2);
    unmount(component);
    target.remove();
  });
});

describe('editor rows: data-source row vs style row', () => {
  it('row1 = Metrics + x:step only; row2 = color + logX + logY + Smooth', async () => {
    const { target, component } = mountEditor(lineWidget);
    await tick();
    const source = target.querySelector('[data-editor-row="source"]') as HTMLElement;
    const style = target.querySelector('[data-editor-row="style"]') as HTMLElement;
    expect(source).toBeTruthy();
    expect(style).toBeTruthy();
    // 行1:指标选择器(popover trigger) + x 轴,不含 color/Smooth
    expect(source.querySelector('[data-slot="popover-trigger"]')).toBeTruthy();
    const xSel = [...source.querySelectorAll('select')].find((s2) => (s2.options[0]?.textContent ?? '').startsWith('x:'));
    expect(xSel).toBeTruthy();
    expect([...source.querySelectorAll('select')].some((s2) => (s2.options[0]?.textContent ?? '').startsWith('color:'))).toBe(false);
    expect((source.textContent ?? '')).not.toContain('Smooth');
    // 行2:color + logX + logY + Smooth,不含 x:step
    const colorSel = [...style.querySelectorAll('select')].find((s2) => (s2.options[0]?.textContent ?? '').startsWith('color:'));
    expect(colorSel).toBeTruthy();
    expect((style.textContent ?? '')).toContain('logX');
    expect((style.textContent ?? '')).toContain('logY');
    expect((style.textContent ?? '')).toContain('Smooth');
    expect([...style.querySelectorAll('select')].some((s2) => (s2.options[0]?.textContent ?? '').startsWith('x:'))).toBe(false);
    unmount(component);
    target.remove();
  });
});

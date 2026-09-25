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

  it('switching to diff emits a bare diff widget', async () => {
    const { target, component, onConfirm } = mountEditor(lineWidget);
    await tick();
    const tab = [...target.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Diff');
    tab!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await tick();
    expect(target.textContent).toContain('无需配置');
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

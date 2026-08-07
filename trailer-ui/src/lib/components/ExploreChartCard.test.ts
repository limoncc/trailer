import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@antv/g2', () => {
  const mockChart = { options: vi.fn(), render: vi.fn(), destroy: vi.fn() };
  return { Chart: vi.fn().mockImplementation(() => mockChart) };
});

import { mount, unmount, tick } from 'svelte';
import type { ComponentProps } from 'svelte';
import ExploreChartCard from './ExploreChartCard.svelte';
import type { ChartDef, RunRecord, SeriesData } from '$lib/utils/explore';

const runs: RunRecord[] = [
  {
    run_id: 'r1',
    name: 'a',
    state: 'finished',
    project: 'p1',
    created_at: 1,
    sweep_id: null,
    config: { params: 1e6 },
    summary: { 'loss/': { last: 0.5 }, 'acc/': { last: 0.9 } },
    owner_id: null,
  },
];

const series: SeriesData = new Map([
  [
    'r1',
    [{ run_id: 'r1', key: 'loss', context: '', points: [{ step: 0, wall_time: 1, value: 0.5, idx: 0 }] }],
  ],
]);

const def: ChartDef = {
  type: 'line',
  x: { kind: 'step' },
  metrics: [{ key: 'loss', context: '' }],
  color: { kind: 'run' },
};

function mountCard(props: ComponentProps<typeof ExploreChartCard>) {
  const target = document.createElement('div');
  document.body.appendChild(target);
  const component = mount(ExploreChartCard, { target, props });
  return { target, component };
}

describe('ExploreChartCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders a line def with title and chart area', async () => {
    const { target, component } = mountCard({ def, runs, series, onChange: vi.fn(), onRemove: vi.fn() });
    await tick();
    expect(target.textContent).toContain('Line');
    expect(target.textContent).toContain('loss');
    unmount(component);
    target.remove();
  });

  it('switching type calls onChange with a scatter def', async () => {
    const onChange = vi.fn();
    const { target, component } = mountCard({ def, runs, series, onChange, onRemove: vi.fn() });
    await tick();
    const select = target.querySelector('select') as HTMLSelectElement;
    select.value = 'scatter';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    expect(onChange).toHaveBeenCalled();
    const newDef = onChange.mock.calls.at(-1)?.[0];
    expect(newDef.type).toBe('scatter');
    unmount(component);
    target.remove();
  });

  it('switching to parallel calls onChange with dims', async () => {
    const onChange = vi.fn();
    const { target, component } = mountCard({ def, runs, series, onChange, onRemove: vi.fn() });
    await tick();
    const select = target.querySelector('select') as HTMLSelectElement;
    select.value = 'parallel';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    expect(onChange).toHaveBeenCalled();
    const newDef = onChange.mock.calls.at(-1)?.[0];
    expect(newDef.type).toBe('parallel');
    expect(newDef.dims.length).toBeGreaterThan(0);
    unmount(component);
    target.remove();
  });

  it('renders a metric picker for line (multi-select)', async () => {
    const { target, component } = mountCard({ def, runs, series, onChange: vi.fn(), onRemove: vi.fn() });
    await tick();
    expect(target.textContent).toContain('Metrics (1/2)');
    unmount(component);
    target.remove();
  });

  it('calls onRemove from the dropdown menu', async () => {
    const onRemove = vi.fn();
    const { target, component } = mountCard({ def, runs, series, onChange: vi.fn(), onRemove });
    await tick();
    // 点击标题栏的 ⋮ trigger(含 svg 的按钮)
    const trigger = [...target.querySelectorAll('button')].find((b) => b.querySelector('svg'));
    trigger!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await tick();
    // bits-ui portal 渲染到 body,查找 "Delete" 菜单项
    const items = [...document.querySelectorAll('[data-slot="dropdown-menu-item"]')];
    const deleteItem = items.find((el) => el.textContent?.includes('Delete'));
    expect(deleteItem).toBeDefined();
    deleteItem!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await tick();
    expect(onRemove).toHaveBeenCalled();
    unmount(component);
    target.remove();
  });
});

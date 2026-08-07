import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@antv/g2', () => {
  const mockChart = {
    options: vi.fn(),
    render: vi.fn(),
    destroy: vi.fn(),
  };
  return { Chart: vi.fn().mockImplementation(() => mockChart) };
});

import { mount, unmount, tick } from 'svelte';
import ExploreChart from './ExploreChart.svelte';
import type { ChartDef } from '$lib/utils/explore';

function mountWith(def: ChartDef, rows: Array<Record<string, unknown>>, colorField = 'run_id', dimensions: string[] = []) {
  const target = document.createElement('div');
  document.body.appendChild(target);
  const component = mount(ExploreChart, { target, props: { def, rows, colorField, dimensions } });
  return { target, component };
}

describe('ExploreChart', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders a line chart for def.type=line', async () => {
    const { Chart } = await import('@antv/g2');
    const mock = { options: vi.fn(), render: vi.fn(), destroy: vi.fn() };
    (Chart as ReturnType<typeof vi.fn>).mockImplementation(() => mock);

    const def: ChartDef = {
      type: 'line',
      x: { kind: 'step' },
      metrics: [{ key: 'loss', context: '' }],
      color: { kind: 'run' },
    };
    const { component } = mountWith(def, [
      { run_id: 'r1', step: 0, value: 1 },
      { run_id: 'r1', step: 1, value: 0.5 },
    ]);
    await tick();
    const options = mock.options.mock.calls.at(-1)?.[0];
    expect(options.type).toBe('line');
    unmount(component);
  });

  it('renders a scatter chart for def.type=scatter', async () => {
    const { Chart } = await import('@antv/g2');
    const mock = { options: vi.fn(), render: vi.fn(), destroy: vi.fn() };
    (Chart as ReturnType<typeof vi.fn>).mockImplementation(() => mock);

    const def: ChartDef = {
      type: 'scatter',
      x: { kind: 'config', path: 'params' },
      y: { kind: 'summary', summaryKey: 'loss/', field: 'last' },
      color: { kind: 'project' },
    };
    const { component } = mountWith(def, [{ x: 1e6, y: 0.5, project: 'p1' }], 'project');
    await tick();
    const options = mock.options.mock.calls.at(-1)?.[0];
    expect(options.type).toBe('point');
    unmount(component);
  });

  // ParallelChart 已改用 Leafer 渲染(jsdom 无 canvas,无法单测),渲染由 parallelUtils 单测 + 浏览器手测覆盖
  it.skip('renders parallel chart for def.type=parallel', async () => {
    const { component } = mountWith(
      { type: 'parallel', dims: [{ kind: 'config', path: 'params' }] },
      [{ run_id: 'r1', 'cfg.params': 1e6 }],
      'run_id',
      ['cfg.params'],
    );
    await tick();
    unmount(component);
  });

  it('renders scatter for scatter-pair (two metrics)', async () => {
    const { Chart } = await import('@antv/g2');
    const mock = { options: vi.fn(), render: vi.fn(), destroy: vi.fn() };
    (Chart as ReturnType<typeof vi.fn>).mockImplementation(() => mock);

    const def: ChartDef = {
      type: 'scatter-pair',
      x: { kind: 'metric', metric: { key: 'loss', context: '' } },
      y: { kind: 'metric', metric: { key: 'acc', context: '' } },
      color: { kind: 'run' },
    };
    const { component } = mountWith(def, [{ x: 0.5, y: 0.8, run_id: 'r1' }]);
    await tick();
    const options = mock.options.mock.calls.at(-1)?.[0];
    expect(options.type).toBe('point');
    unmount(component);
  });
});

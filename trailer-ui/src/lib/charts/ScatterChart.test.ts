import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@antv/g2', () => {
  const mockChart = {
    options: vi.fn(),
    render: vi.fn(),
    destroy: vi.fn(),
  };
  return { Chart: vi.fn().mockImplementation(() => mockChart) };
});

describe('ScatterChart component', () => {
  const sampleData = [
    { x: 1, y: 2 },
    { x: 10, y: 4 },
    { x: 100, y: 8 },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('exports a Chart class for G2', async () => {
    const { Chart } = await import('@antv/g2');
    expect(Chart).toBeDefined();
  });

  it('passes log scale to G2 options when logX/logY are set', async () => {
    const { Chart } = await import('@antv/g2');
    const mockChartInstance = {
      options: vi.fn(),
      render: vi.fn(),
      destroy: vi.fn(),
    };
    (Chart as ReturnType<typeof vi.fn>).mockImplementation(() => mockChartInstance);

    const { mount, unmount, tick } = await import('svelte');
    const { default: ScatterChart } = await import('./ScatterChart.svelte');
    const target = document.createElement('div');
    document.body.appendChild(target);

    const component = mount(ScatterChart, {
      target,
      props: { data: sampleData, logX: true, logY: true },
    });
    await tick();

    const options = mockChartInstance.options.mock.calls.at(-1)?.[0];
    expect(options.scale.x.type).toBe('log');
    expect(options.scale.y.type).toBe('log');

    unmount(component);
    target.remove();
  });
});

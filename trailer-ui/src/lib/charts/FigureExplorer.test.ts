import { describe, it, expect, vi, beforeEach } from 'vitest';

// charts/index.ts 静态导入所有图表组件,jsdom 下编译全组件树耗时,需更长 timeout。
vi.mock('@antv/g2', () => {
  const mockChart = { options: vi.fn(), render: vi.fn(), destroy: vi.fn() };
  return { Chart: vi.fn().mockImplementation(() => mockChart) };
});

function mockFetch(response: unknown) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(response),
  });
}

describe('FigureExplorer component', () => {
  const sampleFigures = [
    { run_id: 'r1', step: 0, name: 'chart', kind: 'png', body: 'base64pseudo' },
    { run_id: 'r1', step: 1, name: 'loss', kind: 'g2', body: JSON.stringify({ type: 'line', data: [{ x: 0, y: 1 }] }) },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('is exported from charts index', async () => {
    const charts = await import('./index.ts');
    expect(charts.FigureExplorer).toBeDefined();
    expect(charts.G2SpecChart).toBeDefined();
  }, 20000);

  it('has FigureExplorer.svelte component file', async () => {
    const mod = await import('./FigureExplorer.svelte');
    expect(mod.default).toBeDefined();
  });

  it('has G2SpecChart.svelte component file', async () => {
    const mod = await import('./G2SpecChart.svelte');
    expect(mod.default).toBeDefined();
  });
});

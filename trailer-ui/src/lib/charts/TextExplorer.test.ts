import { describe, it, expect, vi } from 'vitest';

// charts/index.ts 静态导入所有图表组件,含 @antv/g2。jsdom 下真实加载 G2 会导致超时。
vi.mock('@antv/g2', () => {
  const mockChart = { options: vi.fn(), render: vi.fn(), destroy: vi.fn() };
  return { Chart: vi.fn().mockImplementation(() => mockChart) };
});

describe('TextExplorer component', () => {
  it('is exported from charts index', async () => {
    const charts = await import('./index.ts');
    expect(charts.TextExplorer).toBeDefined();
  }, 20000);

  it('has TextExplorer.svelte component file', async () => {
    const mod = await import('./TextExplorer.svelte');
    expect(mod.default).toBeDefined();
  });
});

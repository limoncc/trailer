import { describe, it, expect, vi } from 'vitest';

// charts/index.ts 静态导入所有图表组件,jsdom 下编译全组件树耗时,需更长 timeout。
vi.mock('@antv/g2', () => {
  const mockChart = { options: vi.fn(), render: vi.fn(), destroy: vi.fn() };
  return { Chart: vi.fn().mockImplementation(() => mockChart) };
});

describe('TableExplorer component', () => {
  it('is exported from charts index', async () => {
    const charts = await import('./index.ts');
    expect(charts.TableExplorer).toBeDefined();
  }, 20000);

  it('has TableExplorer.svelte component file', async () => {
    const mod = await import('./TableExplorer.svelte');
    expect(mod.default).toBeDefined();
  });
});

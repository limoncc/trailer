import { describe, it, expect, vi, beforeEach } from 'vitest';

// jsdom 无 WebGL，mock 掉 PCA3DViewer 类；静态 instances 供测试断言
vi.mock('$lib/pca/pca3d-viewer', () => {
  class MockPCA3DViewer {
    static instances: any[] = [];
    setData = vi.fn();
    setOpacity = vi.fn();
    setPointSize = vi.fn();
    setColors = vi.fn();
    destroy = vi.fn();
    constructor() { MockPCA3DViewer.instances.push(this); }
  }
  return { PCA3DViewer: MockPCA3DViewer };
});

import type { PcaData } from '$lib/pca/pcaTypes';

describe('PCA3DChart component', () => {
  const sampleData: PcaData = {
    meta: { n_samples: 2 },
    points: [
      { x: 0, y: 0, z: 0, cluster: 'A' },
      { x: 1, y: 1, z: 1, cluster: 'A' },
    ],
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates viewer and calls setData on mount, destroys on unmount', async () => {
    const { mount, unmount, tick } = await import('svelte');
    const { default: PCA3DChart } = await import('./PCA3DChart.svelte');
    const mod = await import('$lib/pca/pca3d-viewer');
    const MockViewer = mod.PCA3DViewer as any;
    MockViewer.instances = [];

    const target = document.createElement('div');
    document.body.appendChild(target);

    const comp = mount(PCA3DChart, { target, props: { data: sampleData } });
    await tick();

    expect(MockViewer.instances).toHaveLength(1);
    // 首次加载强制复位视角（keepView: false）
    expect(MockViewer.instances[0].setData).toHaveBeenCalledWith(sampleData, { keepView: false });

    unmount(comp);
    expect(MockViewer.instances[0].destroy).toHaveBeenCalled();
    target.remove();
  });
});

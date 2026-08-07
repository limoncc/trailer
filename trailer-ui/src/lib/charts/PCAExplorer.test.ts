import { describe, it, expect, vi, beforeEach } from 'vitest';

// jsdom 无 WebGL，mock 掉 PCA3DViewer
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

const pcaBody = (n: number) =>
  JSON.stringify({
    meta: { n_samples: n },
    points: Array.from({ length: n }, (_, i) => ({ x: i, y: 0, z: 0, cluster: 'A' })),
  });

function mockFetchFigures() {
  const figures = [
    { run_id: 'r1', step: 0, name: 'pca_emb', kind: 'pca', body: pcaBody(2) },
    { run_id: 'r1', step: 5, name: 'pca_emb', kind: 'pca', body: pcaBody(2) },
    { run_id: 'r1', step: 0, name: 'other_pca', kind: 'pca', body: pcaBody(1) },
    { run_id: 'r1', step: 0, name: 'chart', kind: 'g2', body: '{"type":"line"}' },
    { run_id: 'r1', step: 0, name: 'm', kind: 'model', body: '{}' },
  ];
  return vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(figures) });
}

describe('PCAExplorer component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders only pca cards and groups by name', async () => {
    const fetchMock = mockFetchFigures();
    vi.stubGlobal('fetch', fetchMock);

    const { mount, unmount, tick } = await import('svelte');
    const { default: PCAExplorer } = await import('./PCAExplorer.svelte');
    const target = document.createElement('div');
    document.body.appendChild(target);

    const comp = mount(PCAExplorer, { target, props: { runId: 'r1' } });
    await tick();

    // pca 卡渲染（按 name 分组），g2/model 图不渲染
    await vi.waitFor(() => {
      expect(target.textContent).toContain('pca_emb');
    });
    expect(target.textContent).toContain('other_pca');
    expect(target.textContent).toContain('2 steps');
    expect(target.textContent).not.toContain('chart');
    expect(target.textContent).not.toContain('type');

    unmount(comp);
    target.remove();
    vi.unstubAllGlobals();
  }, 20000);
});

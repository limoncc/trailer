import { describe, it, expect, vi, afterEach } from 'vitest';

/** mock 一个返回 JSON 的 fetch 响应 */
function jsonResponse(body: unknown, ok = true) {
  return {
    ok,
    status: ok ? 200 : 404,
    json: () => Promise.resolve(body),
  } as Response;
}

const detail = { run_id: 'run-1', state: 'finished', created_at: 100, env: { hardware: { gpus: [{}] } } };

describe('fetchRunMeta', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('优先单 run 详情端点', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(detail));
    vi.stubGlobal('fetch', fetchMock);
    const { fetchRunMeta } = await import('./runMeta');
    await expect(fetchRunMeta('run-1')).resolves.toEqual(detail);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/runs/run-1');
  });

  it('详情 404(旧 server 无此端点)→ 回退 runs 列表查找', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(null, false))
      .mockResolvedValueOnce(jsonResponse([{ run_id: 'run-0' }, detail]));
    vi.stubGlobal('fetch', fetchMock);
    const { fetchRunMeta } = await import('./runMeta');
    await expect(fetchRunMeta('run-1')).resolves.toEqual(detail);
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/v1/runs');
  });

  it('详情网络异常 → 回退列表', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(jsonResponse([detail]));
    vi.stubGlobal('fetch', fetchMock);
    const { fetchRunMeta } = await import('./runMeta');
    await expect(fetchRunMeta('run-1')).resolves.toEqual(detail);
  });

  it('列表里也没有该 run → null', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(null, false))
      .mockResolvedValueOnce(jsonResponse([{ run_id: 'run-0' }]));
    vi.stubGlobal('fetch', fetchMock);
    const { fetchRunMeta } = await import('./runMeta');
    await expect(fetchRunMeta('run-1')).resolves.toBeNull();
  });

  it('详情与列表都失败(如过期 share token)→ null', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(null, false))
      .mockResolvedValueOnce(jsonResponse(null, false));
    vi.stubGlobal('fetch', fetchMock);
    const { fetchRunMeta } = await import('./runMeta');
    await expect(fetchRunMeta('run-1')).resolves.toBeNull();
  });

  it('runId 特殊字符 → 详情 URL 编码', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(detail));
    vi.stubGlobal('fetch', fetchMock);
    const { fetchRunMeta } = await import('./runMeta');
    await fetchRunMeta('run/1 x');
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/runs/run%2F1%20x');
  });
});

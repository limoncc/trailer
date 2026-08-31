import { describe, it, expect, vi, afterEach } from 'vitest';

/** mock 一个返回 JSON 的 fetch 响应 */
function jsonResponse(body: unknown, ok = true) {
  return {
    ok,
    json: () => Promise.resolve(body),
  } as Response;
}

describe('fetchServerVersion', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('返回服务端名称与版本', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ name: 'trailer-server', version: '0.1.3' })));
    const { fetchServerVersion } = await import('./version');
    await expect(fetchServerVersion()).resolves.toEqual({ name: 'trailer-server', version: '0.1.3' });
    expect(fetch).toHaveBeenCalledWith('/api/v1/version');
  });

  it('非 2xx 响应 → null', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'nope' }, false)));
    const { fetchServerVersion } = await import('./version');
    await expect(fetchServerVersion()).resolves.toBeNull();
  });

  it('网络异常 → null', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const { fetchServerVersion } = await import('./version');
    await expect(fetchServerVersion()).resolves.toBeNull();
  });

  it('返回体缺 version 字段 → null', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ name: 'trailer-server' })));
    const { fetchServerVersion } = await import('./version');
    await expect(fetchServerVersion()).resolves.toBeNull();
  });
});

describe('UI_VERSION', () => {
  it('注入自 package.json 版本,与发布同步', async () => {
    const { UI_VERSION } = await import('./version');
    const pkg = (await import('../../../package.json')) as { default: { version: string } };
    expect(UI_VERSION).toBe(pkg.default.version);
  });
});

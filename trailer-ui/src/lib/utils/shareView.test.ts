import { describe, it, expect, vi, afterEach } from 'vitest';

describe('isShareView', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('URL 带 ?token= → true(分享只读视图)', async () => {
    vi.stubGlobal('window', { location: new URL('http://x/run/r1?token=abc') });
    const { isShareView } = await import('./shareView');
    expect(isShareView()).toBe(true);
  });

  it('无 token → false(正常登录视图)', async () => {
    vi.stubGlobal('window', { location: new URL('http://x/run/r1') });
    const { isShareView } = await import('./shareView');
    expect(isShareView()).toBe(false);
  });

  it('token 为空串 → false(不算分享态)', async () => {
    vi.stubGlobal('window', { location: new URL('http://x/run/r1?token=') });
    const { isShareView } = await import('./shareView');
    expect(isShareView()).toBe(false);
  });

  it('非浏览器环境(SSR)→ false', async () => {
    const { isShareView } = await import('./shareView');
    vi.stubGlobal('window', undefined);
    expect(isShareView()).toBe(false);
  });
});

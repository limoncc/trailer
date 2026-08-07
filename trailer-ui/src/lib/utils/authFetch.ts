/** Patch global fetch to include auth token for API requests. */
export function initAuthFetch() {
  const orig = window.fetch.bind(window);

  // 页面 URL 上的 share token(匿名共享访问,如 /run/{id}?token=xxx)
  const pageToken = new URLSearchParams(window.location.search).get('token');

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    let url = typeof input === 'string' ? input : input instanceof Request ? input.url : input.toString();
    const token = localStorage.getItem('trailer_token');

    // Only intercept /api/v1/ requests (skip auth endpoints to avoid loops)
    if (url.includes('/api/v1/') && !url.includes('/api/v1/auth/')) {
      // 登录 token → Authorization header
      if (token) {
        init = init || {};
        init.headers = { ...init.headers as Record<string, string>, authorization: `Bearer ${token}` };
      }
      // 页面分享 token → 附加到 query(匿名只读访问)
      if (pageToken && !url.includes('token=')) {
        const sep = url.includes('?') ? '&' : '?';
        url = url + sep + 'token=' + encodeURIComponent(pageToken);
      }
    }

    const resp = await orig(url, init);

    // Only redirect on 401 if we actually sent a token (not for anonymous requests)
    if (resp.status === 401 && token && !url.includes('/api/v1/auth/')) {
      localStorage.removeItem('trailer_token');
      localStorage.removeItem('trailer_user');
      window.location.href = '/login';
    }
    return resp;
  };
}

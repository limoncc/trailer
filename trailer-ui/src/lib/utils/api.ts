/**
 * Authenticated fetch — automatically adds Bearer token to all API requests.
 */
let _token: string | null = null;

export function setToken(t: string | null) {
  _token = t;
  if (t) localStorage.setItem('trailer_token', t);
}

export function getToken(): string | null {
  if (!_token) _token = localStorage.getItem('trailer_token');
  return _token;
}

export function clearToken() {
  _token = null;
  localStorage.removeItem('trailer_token');
  localStorage.removeItem('trailer_user');
}

export async function api(path: string, options: RequestInit = {}): Promise<Response> {
  const token = getToken();
  const headers: Record<string, string> = { ...(options.headers as Record<string, string> || {}) };
  if (token) headers['authorization'] = `Bearer ${token}`;
  const resp = await fetch(path, { ...options, headers });
  // 仅当带着 token 仍 401(登录失效)才跳登录;匿名(分享只读)的 401 不跳转
  if (resp.status === 401 && token) {
    clearToken();
    window.location.href = '/login';
  }
  return resp;
}

/** Fetch metrics + configs + summaries for a set of runs. Used by Compare & Sweeps. */
export async function fetchMultipleRuns(runIds: string[]) {
  if (runIds.length === 0) return { runs: [], metrics: {}, summaries: [], configs: {} };
  const ids = runIds.map(encodeURIComponent).join(',');

  // Fetch all metrics in one batch call
  const metricsResp = await api('/api/v1/metrics:batch-query', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ run_ids: runIds, max_points: 1000 }),
  });
  const metrics = metricsResp.ok ? await metricsResp.json() : {};

  // Fetch run metadata
  const runsResp = await api(`/api/v1/runs/diff?run_id_a=${encodeURIComponent(runIds[0])}&run_id_b=${encodeURIComponent(runIds[runIds.length - 1])}`);
  const configDiff = runsResp.ok ? await runsResp.json() : {};

  return { runs: runIds, metrics, summaries: [], configs: configDiff };
}

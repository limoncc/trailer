/** 服务端版本信息(来自 GET /api/v1/version,单一事实来源为 CARGO_PKG_VERSION)。 */
export interface ServerVersion {
  name: string;
  version: string;
}

/** 前端构建版本(来自 package.json,Vite define 注入);未注入环境回退 'dev'。 */
export const UI_VERSION: string = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev';

/** 拉取服务端版本号;任何失败(非 2xx/网络异常/缺字段)都返回 null,调用方静默降级。 */
export async function fetchServerVersion(): Promise<ServerVersion | null> {
  try {
    const resp = await fetch('/api/v1/version');
    if (!resp.ok) return null;
    const data = (await resp.json()) as Partial<ServerVersion>;
    if (typeof data?.version !== 'string' || data.version === '') return null;
    return { name: typeof data.name === 'string' ? data.name : 'trailer', version: data.version };
  } catch {
    return null;
  }
}

/**
 * 共享认证模块 — 提供 authReady promise，让数据加载可以等待认证完成再发出请求。
 * 解决首次加载时 $effect 竞态条件导致的 401 问题。
 */

let _resolveAuth: (() => void) | undefined;
let _authReady: Promise<void> | undefined;

/** 等待认证完成。数据加载函数应 await 此 promise 后再发 API 请求。 */
export function authReady(): Promise<void> {
  return _authReady ?? Promise.resolve();
}

/** 标记认证已就绪（由 login 流程调用）。 */
export function signalAuthReady(): void {
  _resolveAuth?.();
}

/** 创建 authReady promise（应在 app 启动时由 layout 调用一次）。 */
export function createAuthReadyPromise(): void {
  if (!_authReady) {
    _authReady = new Promise<void>(resolve => {
      _resolveAuth = resolve;
    });
  }
}

/**
 * 侧栏折叠状态 — shadcn Sidebar 的 open 受控源,localStorage 持久化。
 * 不用 Provider 内置 cookie:项目内偏好统一走 trailer-* localStorage 键(见 trailer-sidebar-width)。
 */
export const STORAGE_KEY = 'trailer-sidebar-open';

export class SidebarState {
  open = $state(true);

  constructor() {
    if (typeof localStorage === 'undefined') return;
    try {
      if (localStorage.getItem(STORAGE_KEY) === '0') this.open = false;
    } catch { /* ignore */ }
  }

  setOpen(v: boolean) {
    this.open = v;
    try { localStorage.setItem(STORAGE_KEY, v ? '1' : '0'); } catch { /* ignore */ }
  }

  toggle() {
    this.setOpen(!this.open);
  }
}

export const sidebarState = new SidebarState();

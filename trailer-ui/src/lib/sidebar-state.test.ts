import { beforeEach, describe, expect, it } from 'vitest';
import { SidebarState, STORAGE_KEY } from './sidebar-state.svelte';

describe('SidebarState', () => {
  beforeEach(() => localStorage.clear());

  it('默认展开', () => {
    expect(new SidebarState().open).toBe(true);
  });

  it("localStorage '0' 恢复为折叠", () => {
    localStorage.setItem(STORAGE_KEY, '0');
    expect(new SidebarState().open).toBe(false);
  });

  it("localStorage '1' 恢复为展开", () => {
    localStorage.setItem(STORAGE_KEY, '1');
    expect(new SidebarState().open).toBe(true);
  });

  it('setOpen 更新并持久化到 localStorage', () => {
    const s = new SidebarState();
    s.setOpen(false);
    expect(s.open).toBe(false);
    expect(localStorage.getItem(STORAGE_KEY)).toBe('0');
    s.setOpen(true);
    expect(s.open).toBe(true);
    expect(localStorage.getItem(STORAGE_KEY)).toBe('1');
  });

  it('toggle 翻转当前状态', () => {
    const s = new SidebarState();
    s.toggle();
    expect(s.open).toBe(false);
    s.toggle();
    expect(s.open).toBe(true);
  });

  it('非法存储值回退为展开', () => {
    localStorage.setItem(STORAGE_KEY, 'yes');
    expect(new SidebarState().open).toBe(true);
  });
});

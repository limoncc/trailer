import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, unmount, tick } from 'svelte';

vi.mock('$lib/utils/api', () => ({
  api: vi.fn(async () => ({ ok: true, json: async () => [] })),
}));

import ExploreWorkspace from './ExploreWorkspace.svelte';

async function mountWs(readOnly = false) {
  const target = document.createElement('div');
  document.body.appendChild(target);
  const component = mount(ExploreWorkspace, {
    target,
    props: {
      initialRunIds: ['r1', 'r2'],
      initialWidgets: [
        { id: 'w1', type: 'line', metrics: [{ key: 'loss', context: '' }], xKind: 'step', w: 12, h: 4 },
      ],
      initialTitle: 'demo',
      readOnly,
    },
  });
  await tick();
  await tick();
  await new Promise((r) => setTimeout(r, 10));
  await tick();
  return { target, component };
}

describe('ExploreWorkspace Edit Layout (view mode by default, like Boards)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('starts in view mode: no drag handles until Edit Layout is clicked', async () => {
    const { target, component } = await mountWs();
    const btn = [...target.querySelectorAll('button')].find((b) => (b.textContent ?? '').includes('Edit Layout'));
    expect(btn).toBeTruthy();
    // 默认视图态:没有拖拽把手
    expect(target.querySelector('[title="Drag to move"]')).toBeNull();
    btn!.click();
    await tick();
    await tick();
    // 进入编辑态:出现拖拽把手与删除按钮
    expect(target.querySelector('[title="Drag to move"]')).toBeTruthy();
    expect(target.querySelector('[title="Remove"]')).toBeTruthy();
    unmount(component);
    target.remove();
  });

  it('Add Widget opens Edit Chart first — no card until confirmed', async () => {
    const { target, component } = await mountWs();
    const add = [...target.querySelectorAll('button')].find((b) => (b.textContent ?? '').includes('Add Widget'));
    add!.click();
    await tick();
    await tick();
    // 还没生成卡片,先弹编辑器
    expect(target.querySelector('[title="Drag to move"]')).toBeNull();
    const heading = [...target.querySelectorAll('h3')].find((h) => (h.textContent ?? '').includes('Edit Chart'));
    expect(heading).toBeTruthy();
    // 编辑器里确认 → 才生成卡片
    const confirm = [...target.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Confirm');
    confirm!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await tick();
    await tick();
    // 卡片已生成 + 自动进入 Edit Layout(把手出现),编辑器关闭
    expect(target.querySelector('[title="Drag to move"]')).toBeTruthy();
    expect([...target.querySelectorAll('h3')].find((h) => (h.textContent ?? '').includes('Edit Chart'))).toBeUndefined();
    unmount(component);
    target.remove();
  });

  it('Save exits Edit Layout mode (done editing → view mode)', async () => {
    const { target, component } = await mountWs();
    // 进编辑态
    const layout = [...target.querySelectorAll('button')].find((b) => (b.textContent ?? '').includes('Edit Layout'));
    layout!.click();
    await tick();
    await tick();
    expect(target.querySelector('[title="Drag to move"]')).toBeTruthy();
    // 保存
    const save = [...target.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === 'Save');
    save!.click();
    await new Promise((r) => setTimeout(r, 30));
    await tick();
    // 退出编辑态(把手消失),按钮回到 Edit Layout
    expect(target.querySelector('[title="Drag to move"]')).toBeNull();
    const again = [...target.querySelectorAll('button')].find((b) => (b.textContent ?? '').includes('Edit Layout'));
    expect(again).toBeTruthy();
    unmount(component);
    target.remove();
  });

  it('hides Edit Layout in read-only share view', async () => {
    const { target, component } = await mountWs(true);
    const btn = [...target.querySelectorAll('button')].find((b) => (b.textContent ?? '').includes('Edit Layout'));
    expect(btn).toBeUndefined();
    unmount(component);
    target.remove();
  });
});

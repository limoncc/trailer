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

  it('hides Edit Layout in read-only share view', async () => {
    const { target, component } = await mountWs(true);
    const btn = [...target.querySelectorAll('button')].find((b) => (b.textContent ?? '').includes('Edit Layout'));
    expect(btn).toBeUndefined();
    unmount(component);
    target.remove();
  });
});

import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { mount, unmount, tick } from 'svelte';
import DanmakuLayer from './DanmakuLayer.svelte';
import { danmakuStore, type DanmakuMsg } from '$lib/danmaku/danmakuStore.svelte';

function msg(id: number, fkey: number): DanmakuMsg {
  return { id, run_id: 'r1', nickname: `n${id}`, content: `c${id}`, created_at: 1, fkey };
}

describe('DanmakuLayer (起飞 action)', () => {
  let target: HTMLDivElement;
  let app: Record<string, unknown>;

  beforeEach(() => {
    target = document.createElement('div');
    document.body.appendChild(target);
    danmakuStore.flying = [msg(1, 1)];
  });

  afterEach(() => {
    unmount(app as never);
    target.remove();
    danmakuStore.flying = [];
  });

  it('flying 数组追加时已有元素不重建、起飞样式不被重设(use: action 不重跑)', async () => {
    app = mount(DanmakuLayer, { target });
    await tick();
    const container = target.firstElementChild as HTMLElement;
    const el1 = container.firstElementChild as HTMLElement;
    // jsdom offsetWidth=0 → dur 按 fallback 文本宽估算;关键在 top/animation 不被重设
    expect(el1.style.top).toBe('0px'); // 首条分到轨道 0
    expect(el1.style.animation).toContain('danmaku-x');
    const anim1 = el1.style.animation;

    // 数组新引用追加第 2 条({@attach} 旧实现会让全部元素重跑 → 重占轨道 → top 变 40px)
    danmakuStore.flying = [...danmakuStore.flying, msg(2, 2)];
    await tick();
    expect(container.children.length).toBe(2);
    const el1b = container.firstElementChild as HTMLElement;
    expect(el1b).toBe(el1); // 同一 DOM 节点
    expect(el1b.style.top).toBe('0px'); // 未重新分配轨道
    expect(el1b.style.animation).toBe(anim1); // 动画未被重设
  });

  it('新元素挂载分配到后续空闲轨道', async () => {
    danmakuStore.flying = [msg(1, 1), msg(2, 2)];
    app = mount(DanmakuLayer, { target });
    await tick();
    const container = target.firstElementChild as HTMLElement;
    const tops = [...container.children].map((el) => (el as HTMLElement).style.top);
    expect(tops).toEqual(['0px', '40px']); // 轨道 0、1(TRACK_H=40)
  });

  it('按 fkey keyed 渲染:移除条目只卸载对应节点', async () => {
    danmakuStore.flying = [msg(1, 1), msg(2, 2)];
    app = mount(DanmakuLayer, { target });
    await tick();
    const container = target.firstElementChild as HTMLElement;
    const el1 = container.firstElementChild;
    danmakuStore.flying = danmakuStore.flying.filter((m) => m.fkey !== 1);
    await tick();
    expect(container.children.length).toBe(1);
    expect(container.firstElementChild).not.toBe(el1);
  });
});

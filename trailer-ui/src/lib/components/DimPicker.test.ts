import { describe, it, expect, vi } from 'vitest';
import { mount, unmount, tick } from 'svelte';
import DimPicker from './DimPicker.svelte';
import type { ScalarAxis } from '$lib/utils/explore';

const options = [
  { axis: { kind: 'config', path: 'params' } as ScalarAxis, label: 'config.params' },
  { axis: { kind: 'config', path: 'depth' } as ScalarAxis, label: 'config.depth' },
  { axis: { kind: 'summary', summaryKey: 'loss/', field: 'last' } as ScalarAxis, label: 'loss/[last]' },
  { axis: { kind: 'summary', summaryKey: 'loss/train', field: 'last' } as ScalarAxis, label: 'loss/train[last]' },
];

// bits-ui popover 在 jsdom 下跨测试挂载有全局状态残留,故所有交互收敛到单次挂载覆盖
describe('DimPicker', () => {
  it('renders trigger count, grouped list, per-item remove and clear-all', async () => {
    const target = document.createElement('div');
    document.body.appendChild(target);
    const onValueChange = vi.fn();
    const component = mount(DimPicker, {
      target,
      props: {
        options,
        value: [
          { kind: 'config', path: 'params' },
          { kind: 'summary', summaryKey: 'loss/', field: 'last' },
        ],
        onValueChange,
      },
    });
    await tick();

    expect(target.textContent).toContain('Dimensions (2/4)');

    // 打开 popover
    const trigger = target.querySelector('[data-slot="popover-trigger"]') as HTMLElement;
    trigger.click();
    await tick();
    await tick();

    const bodyText = document.body.textContent ?? '';
    expect(bodyText).toContain('Selected (2)');
    expect(bodyText).toContain('config.params');
    expect(bodyText).toContain('Clear all');
    // 分组头: config / root 存在
    expect(bodyText).toContain('config');
    expect(bodyText).toContain('root');

    // 单个移除
    const removeBtn = [...document.body.querySelectorAll('button')].find(
      (b) => b.getAttribute('aria-label') === 'Remove config.params',
    );
    expect(removeBtn).toBeDefined();
    removeBtn!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await tick();
    expect(onValueChange).toHaveBeenCalledWith([{ kind: 'summary', summaryKey: 'loss/', field: 'last' }]);

    // 一键清除
    onValueChange.mockClear();
    const clearBtn = [...document.body.querySelectorAll('button')].find((b) => b.textContent?.includes('Clear all'));
    expect(clearBtn).toBeDefined();
    clearBtn!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await tick();
    expect(onValueChange).toHaveBeenCalledWith([]);

    unmount(component);
    target.remove();
  });
});

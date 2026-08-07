import { describe, it, expect, vi } from 'vitest';
import { mount, unmount, tick } from 'svelte';
import MetricPicker from './MetricPicker.svelte';

const options = [
  { key: 'loss', context: 'train' },
  { key: 'acc', context: 'train' },
  { key: 'cpu', context: 'system' },
];

// bits-ui popover 在 jsdom 下跨测试挂载有全局状态残留,故所有交互收敛到单次挂载覆盖
describe('MetricPicker', () => {
  it('renders trigger count, selected list in panel, per-item remove and clear-all', async () => {
    const target = document.createElement('div');
    document.body.appendChild(target);
    const onValueChange = vi.fn();
    const component = mount(MetricPicker, {
      target,
      props: {
        options,
        value: [
          { key: 'loss', context: 'train' },
          { key: 'cpu', context: 'system' },
        ],
        onValueChange,
      },
    });
    await tick();

    expect(target.textContent).toContain('Metrics (2/3)');

    // 打开 popover
    const trigger = target.querySelector('[data-slot="popover-trigger"]') as HTMLElement;
    trigger.click();
    await tick();
    await tick();

    const bodyText = document.body.textContent ?? '';
    expect(bodyText).toContain('Selected (2)');
    expect(bodyText).toContain('loss [train]');
    expect(bodyText).toContain('cpu [system]');
    expect(bodyText).toContain('Clear all');

    // 单个移除
    const removeBtn = [...document.body.querySelectorAll('button')].find(
      (b) => b.getAttribute('aria-label') === 'Remove loss [train]',
    );
    expect(removeBtn).toBeDefined();
    removeBtn!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await tick();
    expect(onValueChange).toHaveBeenCalledWith([{ key: 'cpu', context: 'system' }]);

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

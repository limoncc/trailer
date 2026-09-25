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

  it('nests multi-slash contexts into a dir chain (eval → train, no longer flattened)', async () => {
    const target = document.createElement('div');
    document.body.appendChild(target);
    const evalOptions = [
      { axis: { kind: 'summary', summaryKey: 'sr_d2/eval/train', field: 'last' } as ScalarAxis, label: 'eval/train/sr_d2[last]' },
      { axis: { kind: 'summary', summaryKey: 'sr/eval/test', field: 'last' } as ScalarAxis, label: 'eval/test/sr[last]' },
    ];
    const component = mount(DimPicker, {
      target,
      props: { options: evalOptions, value: [], onValueChange: vi.fn() },
    });
    await tick();
    const trigger = target.querySelector('[data-slot="popover-trigger"]') as HTMLElement;
    trigger.click();
    await tick();
    await tick();

    // 旧契约(首段压扁)已废除:train/test 现在是 eval 下的**子目录**
    const dirs = [...document.body.querySelectorAll('[data-tree-dir]')];
    const byPath = (p: string) => dirs.find((d) => d.getAttribute('data-tree-path') === p);
    expect(byPath('eval')).toBeTruthy();
    expect(byPath('eval/train')).toBeTruthy();
    expect(byPath('eval/test')).toBeTruthy();
    expect(Number(byPath('eval')!.getAttribute('data-tree-depth'))).toBe(0);
    expect(Number(byPath('eval/train')!.getAttribute('data-tree-depth'))).toBe(1);
    // 组头计数 = 子树叶子数
    const headers = [...document.body.querySelectorAll('button')].filter((b) =>
      /^(.+) \(\d+\)$/.test(b.textContent?.trim() ?? ''),
    );
    const labels = headers.map((b) => b.textContent?.trim());
    expect(labels).toContain('eval (2)');

    unmount(component);
    target.remove();
  });

  it('nests dotted config paths into dirs (config → model → depth)', async () => {
    const target = document.createElement('div');
    document.body.appendChild(target);
    const opts = [
      { axis: { kind: 'config', path: 'model.depth' } as ScalarAxis, label: 'config.model.depth' },
      { axis: { kind: 'config', path: 'params' } as ScalarAxis, label: 'config.params' },
    ];
    const component = mount(DimPicker, {
      target,
      props: { options: opts, value: [], onValueChange: vi.fn() },
    });
    await tick();
    (target.querySelector('[data-slot="popover-trigger"]') as HTMLElement).click();
    await tick();
    await tick();
    const dirs = [...document.body.querySelectorAll('[data-tree-dir]')];
    const paths = dirs.map((d) => d.getAttribute('data-tree-path'));
    expect(paths).toContain('config');
    expect(paths).toContain('config/model');
    // 叶子 = 最后一级键名(路径由目录表达)
    const leaves = [...document.body.querySelectorAll('[data-tree-leaf]')].map((l) =>
      (l.textContent ?? '').trim(),
    );
    expect(leaves).toContain('depth');
    expect(leaves).toContain('params');
    expect(leaves.join('|')).not.toContain('config.model.depth');

    unmount(component);
    target.remove();
  });
});

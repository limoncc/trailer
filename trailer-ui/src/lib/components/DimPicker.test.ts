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

// ─── flat 变体:与 Metrics 同款(大写组头 + chevron + 原生 checkbox,组内平铺完整 label) ───

describe('DimPicker flat variant', () => {
  async function mountFlat(props: Record<string, unknown>) {
    const target = document.createElement('div');
    document.body.appendChild(target);
    const component = mount(DimPicker, { target, props: { variant: 'flat', ...props } } as never);
    await tick();
    (target.querySelector('[data-slot="popover-trigger"]') as HTMLElement).click();
    await tick();
    await tick();
    return { target, component };
  }

  it('groups under chevron headers with native checkbox rows and full labels', async () => {
    const opts = [
      { axis: { kind: 'config', path: 'model.depth' } as ScalarAxis, label: 'config.model.depth' },
      { axis: { kind: 'config', path: 'params' } as ScalarAxis, label: 'config.params' },
      { axis: { kind: 'summary', summaryKey: 'loss/train', field: 'last' } as ScalarAxis, label: 'loss/train[last]' },
    ];
    const { target, component } = await mountFlat({ options: opts, value: [], onValueChange: vi.fn() });
    const groups = [...document.body.querySelectorAll('[data-dim-group]')] as HTMLElement[];
    // 顶层组:config / train(首段)
    expect(groups.length).toBeGreaterThanOrEqual(2);
    const head = groups[0].querySelector(':scope > div') as HTMLElement;
    expect(head.querySelector('.uppercase')).toBeTruthy();
    expect(head.querySelector('button[aria-label$="group"]')).toBeTruthy();
    // 平铺叶:完整 label + 原生 checkbox(不是折叠树的 command-item)
    const rows = [...document.body.querySelectorAll('[data-dim-group] label')] as HTMLElement[];
    const texts = rows.map((r) => (r.textContent ?? '').trim());
    expect(texts).toContain('config.model.depth');
    expect(texts).toContain('config.params');
    expect(texts).toContain('loss/train[last]');
    expect(document.body.querySelector('[data-tree-dir]')).toBeNull();
    unmount(component);
    target.remove();
    document.querySelectorAll('[data-slot="popover-content"]').forEach((e) => e.remove());
  });

  it('Collapse hides rows; Expand brings them back; clicking a row toggles the dim', async () => {
    const opts = [
      { axis: { kind: 'config', path: 'params' } as ScalarAxis, label: 'config.params' },
    ];
    const onValueChange = vi.fn();
    const { target, component } = await mountFlat({ options: opts, value: [], onValueChange });
    const tool = (label: string) =>
      [...document.body.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === label)!;
    expect(document.body.querySelector('[data-dim-group] label')).toBeTruthy();
    tool('Collapse').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await tick();
    expect(document.body.querySelector('[data-dim-group] label')).toBeNull();
    tool('Expand').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await tick();
    const row = document.body.querySelector('[data-dim-group] label input') as HTMLInputElement;
    expect(row).toBeTruthy();
    row.click();
    await tick();
    expect(onValueChange).toHaveBeenCalledWith([{ kind: 'config', path: 'params' }]);
    unmount(component);
    target.remove();
    document.querySelectorAll('[data-slot="popover-content"]').forEach((e) => e.remove());
  });
});

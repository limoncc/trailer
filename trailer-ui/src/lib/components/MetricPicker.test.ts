import { describe, it, expect, vi, afterEach } from 'vitest';
import { mount, unmount, tick } from 'svelte';
import MetricPicker from './MetricPicker.svelte';

const options = [
  { key: 'loss', context: 'train' },
  { key: 'acc', context: 'train' },
  { key: 'cpu', context: 'system' },
];

// bits-ui popover portal 残留在 body;跨 it 查询会命中已销毁组件的失效节点 → 每轮清空
afterEach(() => {
  document.body.innerHTML = '';
});

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

// ─── 层级树:context 逐段成目录,指标 → run 两层,勾选细化到 run ───

const treeOptions = [
  { key: 'loss', context: 'train' },
  { key: 'batch_size', context: 'train/s1_seq32k' },
  { key: 'lr', context: '' },
];

async function mountPicker(props: Record<string, unknown>) {
  const target = document.createElement('div');
  document.body.appendChild(target);
  const component = mount(MetricPicker, { target, props } as never);
  await tick();
  const trigger = target.querySelector('[data-slot="popover-trigger"]') as HTMLElement;
  trigger.click();
  await tick();
  await tick();
  return { target, component };
}

function dirs(): HTMLElement[] {
  return [...document.body.querySelectorAll('[data-tree-dir]')] as HTMLElement[];
}

function leaves(): HTMLElement[] {
  return [...document.body.querySelectorAll('[data-tree-leaf]')] as HTMLElement[];
}

function headerButton(path: string): HTMLElement {
  const dir = dirs().find((d) => d.getAttribute('data-tree-path') === path);
  expect(dir, `dir ${path}`).toBeTruthy();
  const btn = [...dir!.querySelectorAll('button')].find((b) => /\(\d+\)/.test(b.textContent ?? ''));
  expect(btn, `header of ${path}`).toBeTruthy();
  return btn!;
}

/** 折叠开关:组头行第一个按钮(chevron);label button 是勾选,别混用 */
function chevronButton(path: string): HTMLElement {
  const dir = dirs().find((d) => d.getAttribute('data-tree-path') === path);
  expect(dir, `dir ${path}`).toBeTruthy();
  const btn = dir!.querySelector('button') as HTMLElement | null;
  expect(btn, `chevron of ${path}`).toBeTruthy();
  return btn!;
}

/** 树断言统一走 formatLeaf(= 纯 key),叶文本不带 context 重复 */
const leafKey = (m: { key: string; context: string }) => m.key;

describe('MetricPicker hierarchical tree', () => {
  it('nests multi-segment context into dirs; leaves show only the key', async () => {
    const { target, component } = await mountPicker({ options: treeOptions, value: [], onValueChange: vi.fn(), formatLeaf: leafKey });
    const paths = dirs().map((d) => d.getAttribute('data-tree-path'));
    expect(paths).toContain('root'); // 空 context → root 目录
    expect(paths).toContain('train');
    expect(paths).toContain('train/s1_seq32k'); // context 第 2 段 = 第 2 层目录
    // 层级深度:s1_seq32k 在 train 之下
    const byPath = (p: string) => dirs().find((d) => d.getAttribute('data-tree-path') === p)!;
    expect(Number(byPath('train').getAttribute('data-tree-depth'))).toBe(0);
    expect(Number(byPath('train/s1_seq32k').getAttribute('data-tree-depth'))).toBe(1);
    // 叶子只显示 key(路径由目录表达),不带完整 context 串
    const texts = leaves().map((l) => (l.textContent ?? '').trim());
    expect(texts).toContain('loss');
    expect(texts).toContain('batch_size');
    expect(texts).toContain('lr');
    expect(texts.join('|')).not.toContain('train/s1_seq32k/batch_size');
    // 缩进随深度递增:同为叶子,s1_seq32k 下的比 train 下的深
    const pad = (l: HTMLElement) => parseFloat(l.style.paddingLeft);
    const leafOf = (key: string) => leaves().find((l) => (l.textContent ?? '').trim() === key)!;
    expect(pad(leafOf('batch_size'))).toBeGreaterThan(pad(leafOf('loss')));
    // 组头计数 = 子树叶子数(train: loss + batch_size = 2)
    expect(headerButton('train').textContent).toContain('train (2)');
    expect(headerButton('train/s1_seq32k').textContent).toContain('s1_seq32k (1)');
    unmount(component);
    target.remove();
  });

  it('collapses a dir hiding its subtree; search force-expands', async () => {
    const onValueChange = vi.fn();
    const { target, component } = await mountPicker({ options: treeOptions, value: [], onValueChange, formatLeaf: leafKey });
    // 收起 train → 其叶子(含子目录)消失
    chevronButton('train').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await tick();
    expect(dirs().find((d) => d.getAttribute('data-tree-path') === 'train/s1_seq32k')).toBeUndefined();
    expect(leaves().map((l) => (l.textContent ?? '').trim())).toEqual(['lr']);
    // 再点展开
    chevronButton('train').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await tick();
    expect(dirs().find((d) => d.getAttribute('data-tree-path') === 'train/s1_seq32k')).toBeTruthy();
    // 搜索时强制展开(命中分支可见)
    chevronButton('train').dispatchEvent(new MouseEvent('click', { bubbles: true })); // 收起
    await tick();
    const input = document.body.querySelector('input[placeholder="Search metrics..."]') as HTMLInputElement;
    input.value = 'batch_size';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await tick();
    expect(leaves().map((l) => (l.textContent ?? '').trim())).toEqual(['batch_size']);
    // 点击搜索结果仍走勾选回调
    onValueChange.mockClear();
    leaves()[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await tick();
    expect(onValueChange).toHaveBeenCalledWith([{ key: 'batch_size', context: 'train/s1_seq32k' }]);
    unmount(component);
    target.remove();
  });

  it('checks a plain metric leaf (no owners → no run layer)', async () => {
    const onValueChange = vi.fn();
    const { target, component } = await mountPicker({ options: treeOptions, value: [], onValueChange, formatLeaf: leafKey });
    // 无 owners → 指标是叶子,没有 data-tree-run
    expect(leaves().every((l) => !l.hasAttribute('data-tree-run'))).toBe(true);
    const loss = leaves().find((l) => (l.textContent ?? '').trim() === 'loss')!;
    loss.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await tick();
    expect(onValueChange).toHaveBeenCalledWith([{ key: 'loss', context: 'train' }]);
    unmount(component);
    target.remove();
  });
});

// ─── run 层:owners 存在时指标变目录,run 是叶子,勾选写回 run_ids ───

const runOptions = [
  { key: 'loss', context: 'train', owners: ['r1', 'r2'] },
  { key: 'acc', context: 'train' }, // 无 owners → 仍是普通叶子
];
const runLabelOf = (id: string) => (id === 'r1' ? 'alpha' : 'beta');

function metricDir(): HTMLElement {
  const dir = dirs().find((d) => d.getAttribute('data-metric-id') === 'loss[train]');
  expect(dir, 'metric dir').toBeTruthy();
  return dir!;
}

function runLeaf(runId: string): HTMLElement {
  const leaf = leaves().find((l) => l.getAttribute('data-tree-run') === runId);
  expect(leaf, `run leaf ${runId}`).toBeTruthy();
  return leaf!;
}

describe('MetricPicker run layer (先选指标,再选 run)', () => {
  it('renders owners as run leaves under the metric dir', async () => {
    const { target, component } = await mountPicker({
      options: runOptions, value: [], onValueChange: vi.fn(), runLabelOf, formatLeaf: leafKey,
    });
    // 指标 loss 升级为目录,run 叶显示 runLabelOf 的显示名
    expect(metricDir()).toBeTruthy();
    expect(runLeaf('r1').textContent).toContain('alpha');
    expect(runLeaf('r2').textContent).toContain('beta');
    // 无 owners 的 acc 仍是普通叶子
    const acc = leaves().find((l) => (l.textContent ?? '').trim() === 'acc');
    expect(acc).toBeTruthy();
    expect(acc!.hasAttribute('data-tree-run')).toBe(false);
    // run 叶比指标目录深一层
    expect(Number(runLeaf('r1').getAttribute('data-tree-depth'))).toBe(
      Number(metricDir().getAttribute('data-tree-depth')) + 1
    );
    unmount(component);
    target.remove();
  });

  it('checking one run writes run_ids; checking the metric dir selects all (run_ids undefined)', async () => {
    const onValueChange = vi.fn();
    const { target, component } = await mountPicker({
      options: runOptions, value: [], onValueChange, runLabelOf,
    });
    // 勾单个 run → 该指标 run_ids = [r1]
    runLeaf('r1').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await tick();
    expect(onValueChange).toHaveBeenCalledWith([{ key: 'loss', context: 'train', run_ids: ['r1'] }]);
    // 勾指标目录 → 全选(不带 run_ids = 全部)
    onValueChange.mockClear();
    metricDir().querySelector('button.flex-1')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await tick();
    expect(onValueChange).toHaveBeenCalledWith([{ key: 'loss', context: 'train' }]);
    unmount(component);
    target.remove();
  });

  it('unchecking the last checked run removes the metric entirely', async () => {
    const onValueChange = vi.fn();
    const { target, component } = await mountPicker({
      options: runOptions, value: [{ key: 'loss', context: 'train', run_ids: ['r1'] }], onValueChange, runLabelOf,
    });
    // 再点已勾的 run → 删空 → 指标整个移除
    runLeaf('r1').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await tick();
    expect(onValueChange).toHaveBeenCalledWith([]);
    // 点指标目录(部分选中)→ 补全为全选
    onValueChange.mockClear();
    metricDir().querySelector('button.flex-1')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await tick();
    expect(onValueChange).toHaveBeenCalledWith([{ key: 'loss', context: 'train' }]);
    unmount(component);
    target.remove();
  });

  it('unchecking one run from a fully-selected metric shrinks run_ids to the rest', async () => {
    const onValueChange = vi.fn();
    const { target, component } = await mountPicker({
      options: runOptions, value: [{ key: 'loss', context: 'train' }], onValueChange, runLabelOf,
    });
    // 全选(undefined)状态下点 alpha → 其余 owners 成显式 run_ids
    runLeaf('r1').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await tick();
    expect(onValueChange).toHaveBeenCalledWith([{ key: 'loss', context: 'train', run_ids: ['r2'] }]);
    // 点指标目录(已全选)→ 取消整个指标
    onValueChange.mockClear();
    metricDir().querySelector('button.flex-1')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await tick();
    expect(onValueChange).toHaveBeenCalledWith([]);
    unmount(component);
    target.remove();
  });
});

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

  it('checking one run writes run_ids; checking the metric dir adds it with ZERO runs (默认不勾)', async () => {
    const onValueChange = vi.fn();
    const { target, component } = await mountPicker({
      options: runOptions, value: [], onValueChange, runLabelOf,
    });
    // 勾单个 run → 该指标 run_ids = [r1]
    runLeaf('r1').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await tick();
    expect(onValueChange).toHaveBeenCalledWith([{ key: 'loss', context: 'train', run_ids: ['r1'] }]);
    // 勾指标目录 → 加入但**一个 run 都不勾**(手动挑,不默认全选)
    onValueChange.mockClear();
    metricDir().querySelector('button.flex-1')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await tick();
    expect(onValueChange).toHaveBeenCalledWith([{ key: 'loss', context: 'train', run_ids: [] }]);
    unmount(component);
    target.remove();
  });

  it('unchecking the last run keeps the metric with zero runs; dir click removes it', async () => {
    const onValueChange = vi.fn();
    const { target, component } = await mountPicker({
      options: runOptions, value: [{ key: 'loss', context: 'train', run_ids: ['r1'] }], onValueChange, runLabelOf,
    });
    // 取消最后一个已勾 run → run_ids 清空但指标保留(等手动重挑)
    runLeaf('r1').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await tick();
    expect(onValueChange).toHaveBeenCalledWith([{ key: 'loss', context: 'train', run_ids: [] }]);
    // 点指标目录(指标已在卡中)→ 移除整个指标
    onValueChange.mockClear();
    metricDir().querySelector('button.flex-1')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await tick();
    expect(onValueChange).toHaveBeenCalledWith([]);
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

// ─── flat 变体:Boards(Add Chart)同款布局 —— 大写组头 + 原生 checkbox,勾选后展开 run 行 ───

describe('MetricPicker flat variant (Boards Add Chart 样式)', () => {
  async function mountFlat(props: Record<string, unknown>) {
    const { target, component } = await mountPicker({ variant: 'flat', ...props });
    return { target, component };
  }

  function groupHeads(): HTMLElement[] {
    return [...document.body.querySelectorAll('[data-metric-group]')] as HTMLElement[];
  }

  function metricRow(id: string): HTMLElement {
    const row = [...document.body.querySelectorAll<HTMLElement>('[data-metric-id]')].find(
      (e) => e.getAttribute('data-metric-id') === id
    );
    expect(row, `metric row ${id}`).toBeTruthy();
    return row!;
  }

  it('renders uppercase group heads with native checkboxes, no chevron buttons', async () => {
    const { target, component } = await mountFlat({
      options: runOptions, value: [], onValueChange: vi.fn(), runLabelOf,
    });
    const heads = groupHeads();
    expect(heads.length).toBeGreaterThan(0);
    // 组头行 = boards 同款大写小标:只有展收 chevron + 文本(无三态 checkbox、无 (N) 计数按钮)
    const headRow = heads[0].querySelector(':scope > div') as HTMLElement;
    const headText = headRow.querySelector('.uppercase') as HTMLElement;
    expect(headText).toBeTruthy();
    expect(headText.className).toContain('font-mono');
    expect(headRow.querySelector('input[type="checkbox"]')).toBeNull();
    expect(headRow.querySelector('button[aria-label$="group"]')).toBeTruthy(); // 展收入口
    expect(/\(\d+\)/.test(headRow.textContent ?? '')).toBe(false);
    // 指标行:原生 checkbox + 文本
    const loss = metricRow('loss[train]');
    const box = loss.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(box).toBeTruthy();
    expect(box.checked).toBe(false);
    // 未勾选 → 不展开 run 行(boards 勾选才出现下级的同构交互)
    expect(loss.querySelectorAll('[data-tree-run]').length).toBe(0);
    unmount(component);
    target.remove();
  });

  it('checking the metric reveals run rows labeled "<name> (run_xx)" and writes run_ids', async () => {
    const onValueChange = vi.fn();
    const { target, component } = await mountFlat({
      options: runOptions,
      value: [{ key: 'loss', context: 'train' }],
      onValueChange,
      runLabelOf,
    });
    const loss = metricRow('loss[train]');
    // 勾选后展开两个 run 行(文本 = runLabelOf 结果,data 锚点为 run_id)
    const runRows = [...loss.querySelectorAll('[data-tree-run]')] as HTMLElement[];
    expect(runRows.map((r) => r.getAttribute('data-tree-run'))).toEqual(['r1', 'r2']);
    expect(runRows[0].textContent).toContain('alpha');
    // 指标行 = 全选态;acc 未勾 → 不展开
    const box = loss.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(box.checked).toBe(true);
    expect(metricRow('acc[train]').querySelectorAll('[data-tree-run]').length).toBe(0);
    // 取消一个 run → 写回 run_ids,指标行转半选
    const r1Box = runRows[0].querySelector('input[type="checkbox"]') as HTMLInputElement;
    r1Box.click();
    await tick();
    expect(onValueChange).toHaveBeenCalledWith([
      { key: 'loss', context: 'train', run_ids: ['r2'] },
    ]);
    unmount(component);
    target.remove();
  });

  it('shows an indeterminate metric box when only some runs are checked', async () => {
    const { target, component } = await mountFlat({
      options: runOptions,
      value: [{ key: 'loss', context: 'train', run_ids: ['r1'] }],
      onValueChange: vi.fn(),
      runLabelOf,
    });
    const box = metricRow('loss[train]').querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(box.indeterminate).toBe(true);
    expect(box.checked).toBe(false);
    unmount(component);
    target.remove();
  });
});

// ─── flat 展收:Expand / Collapse / Expand 1 level + 组头/指标行折叠 ───

describe('MetricPicker flat collapse controls', () => {
  function toolbarBtn(label: string): HTMLElement {
    const btn = [...document.body.querySelectorAll('button')].find(
      (b) => (b.textContent ?? '').trim() === label
    );
    expect(btn, `toolbar ${label}`).toBeTruthy();
    return btn!;
  }

  function metricRow(id: string): HTMLElement {
    const row = [...document.body.querySelectorAll<HTMLElement>('[data-metric-id]')].find(
      (e) => e.getAttribute('data-metric-id') === id
    );
    expect(row, `metric row ${id}`).toBeTruthy();
    return row!;
  }

  it('offers Expand / Collapse / Expand 1 level in the toolbar', async () => {
    const { target, component } = await mountPicker({
      variant: 'flat', options: runOptions, value: [{ key: 'loss', context: 'train', run_ids: ['r1'] }],
      onValueChange: vi.fn(), runLabelOf,
    });
    toolbarBtn('Expand');
    toolbarBtn('Collapse');
    toolbarBtn('Expand 1 level');
    unmount(component);
    target.remove();
  });

  it('Collapse hides groups; Expand 1 level reopens groups but keeps run rows folded', async () => {
    const { target, component } = await mountPicker({
      variant: 'flat', options: runOptions, value: [{ key: 'loss', context: 'train', run_ids: ['r1'] }],
      onValueChange: vi.fn(), runLabelOf,
    });
    // Collapse → 只剩组头,指标与 run 行都收起
    toolbarBtn('Collapse').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await tick();
    expect(document.body.querySelectorAll('[data-metric-id]').length).toBe(0);
    expect(document.body.querySelectorAll('[data-tree-run]').length).toBe(0);
    // Expand 1 level → 指标行回来,勾选指标的 run 行仍收着
    toolbarBtn('Expand 1 level').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await tick();
    expect(metricRow('loss[train]')).toBeTruthy();
    expect(document.body.querySelectorAll('[data-tree-run]').length).toBe(0);
    // Expand → run 行展开
    toolbarBtn('Expand').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await tick();
    expect(document.body.querySelectorAll('[data-tree-run]').length).toBe(2);
    unmount(component);
    target.remove();
  });

  it('the metric-row chevron folds/unfolds its run rows (entry present)', async () => {
    const { target, component } = await mountPicker({
      variant: 'flat', options: runOptions,
      value: [{ key: 'loss', context: 'train', run_ids: ['r1'] }],
      onValueChange: vi.fn(), runLabelOf,
    });
    expect(document.body.querySelectorAll('[data-tree-run]').length).toBe(2);
    // 指标行 chevron 折回
    const chev = metricRow('loss[train]').querySelector('button[aria-label$="group"]') as HTMLElement;
    expect(chev).toBeTruthy();
    chev.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await tick();
    expect(document.body.querySelectorAll('[data-tree-run]').length).toBe(0);
    // 再点展开
    metricRow('loss[train]').querySelector('button[aria-label$="group"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await tick();
    expect(document.body.querySelectorAll('[data-tree-run]').length).toBe(2);
    unmount(component);
    target.remove();
  });
});

// ─── Selected chip 带 run 名(同名 run 靠 (run_xx) 区分) ───

describe('MetricPicker selected chips carry run names', () => {
  it('shows "<base> — <run label>" on the chip when run_ids are explicit', async () => {
    const { target, component } = await mountPicker({
      variant: 'flat',
      options: runOptions,
      value: [{ key: 'loss', context: 'train', run_ids: ['r1'] }],
      onValueChange: vi.fn(),
      runLabelOf,
      formatChip: (m: { run_ids?: string[] }) =>
        m.run_ids?.length ? `loss [train] — ${m.run_ids.map(runLabelOf).join(', ')}` : 'loss [train]',
    });
    const body = document.body.textContent ?? '';
    expect(body).toContain('loss [train] — alpha'); // runLabelOf(r1) = alpha
    unmount(component);
    target.remove();
  });

  it('shows "(no runs)" when the metric is checked with zero runs', async () => {
    const { target, component } = await mountPicker({
      variant: 'flat',
      options: runOptions,
      value: [{ key: 'loss', context: 'train', run_ids: [] }],
      onValueChange: vi.fn(),
      runLabelOf,
      formatChip: (m: { run_ids?: string[] }) =>
        m.run_ids && m.run_ids.length === 0 ? 'loss [train] — (no runs)' : 'loss [train]',
    });
    expect(document.body.textContent).toContain('loss [train] — (no runs)');
    unmount(component);
    target.remove();
  });
});

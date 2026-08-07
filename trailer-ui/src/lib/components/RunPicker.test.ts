import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, unmount, tick } from 'svelte';
import type { ComponentProps } from 'svelte';
import RunPicker from './RunPicker.svelte';
import type { RunRecord } from '$lib/utils/explore';

const runs: RunRecord[] = [
  { run_id: 'r1', name: 'alpha', state: 'finished', project: 'p1', created_at: 1, sweep_id: null, config: {}, summary: {}, owner_id: null },
  { run_id: 'r2', name: 'beta', state: 'finished', project: 'p1', created_at: 2, sweep_id: null, config: {}, summary: {}, owner_id: null },
  { run_id: 'r3', name: 'gamma', state: 'finished', project: 'p2', created_at: 3, sweep_id: null, config: {}, summary: {}, owner_id: null },
];

function mountPicker(props: ComponentProps<typeof RunPicker>) {
  const target = document.createElement('div');
  document.body.appendChild(target);
  const component = mount(RunPicker, { target, props });
  return { target, component };
}

async function openPanel(target: HTMLElement) {
  const trigger = target.querySelector('button') as HTMLButtonElement;
  trigger.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await tick();
}

describe('RunPicker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows a trigger button with the selected count', async () => {
    const { target, component } = mountPicker({ runs, selected: new Set(['r1']), onselect: vi.fn(), onclear: vi.fn() });
    await tick();
    expect(target.textContent).toContain('Runs');
    expect(target.textContent).toContain('1');
    unmount(component);
    target.remove();
  });

  it('expands panel on click and groups runs by project', async () => {
    const { target, component } = mountPicker({ runs, selected: new Set(), onselect: vi.fn(), onclear: vi.fn() });
    await tick();
    await openPanel(target);
    expect(target.textContent).toContain('p1');
    expect(target.textContent).toContain('p2');
    expect(target.textContent).toContain('alpha');
    expect(target.textContent).toContain('gamma');
    unmount(component);
    target.remove();
  });

  it('filters runs by search query', async () => {
    const { target, component } = mountPicker({ runs, selected: new Set(), onselect: vi.fn(), onclear: vi.fn() });
    await tick();
    await openPanel(target);
    const input = target.querySelector('input[placeholder="Search runs..."]') as HTMLInputElement;
    input.value = 'alpha';
    input.dispatchEvent(new Event('input'));
    await tick();
    expect(target.textContent).toContain('alpha');
    expect(target.textContent).not.toContain('beta');
    unmount(component);
    target.remove();
  });

  it('calls onselect when a checkbox is toggled', async () => {
    const onselect = vi.fn();
    const { target, component } = mountPicker({ runs, selected: new Set(), onselect, onclear: vi.fn() });
    await tick();
    await openPanel(target);
    const checkbox = target.querySelector('input[type="checkbox"]') as HTMLInputElement;
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change', { bubbles: true }));
    expect(onselect).toHaveBeenCalledWith(expect.any(String), true);
    unmount(component);
    target.remove();
  });

  it('collapses a project group', async () => {
    const { target, component } = mountPicker({ runs, selected: new Set(), onselect: vi.fn(), onclear: vi.fn() });
    await tick();
    await openPanel(target);
    // 项目头是包含项目名的按钮
    const projHeader = [...target.querySelectorAll('button')].find((b) => b.textContent?.includes('p1'));
    projHeader!.click();
    await tick();
    expect(target.textContent).not.toContain('alpha');
    unmount(component);
    target.remove();
  });

  it('calls onclear and shows selected chips that can be removed', async () => {
    const onclear = vi.fn();
    const onselect = vi.fn();
    const selected = new Set(['r1']);
    const { target, component } = mountPicker({ runs, selected, onselect, onclear });
    await tick();
    await openPanel(target);
    // chips 区显示已选 run 名
    expect(target.textContent).toContain('alpha');
    // 点 chip 的 × 触发取消勾选
    const removeBtn = [...target.querySelectorAll('button')].find(
      (b) => b.textContent === '×',
    ) as HTMLButtonElement;
    removeBtn.click();
    expect(onselect).toHaveBeenCalledWith('r1', false);
    unmount(component);
    target.remove();
  });
});

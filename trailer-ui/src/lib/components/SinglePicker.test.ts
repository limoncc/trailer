import { describe, it, expect, vi, afterEach } from 'vitest';
import { mount, unmount, tick } from 'svelte';
import SinglePicker from './SinglePicker.svelte';

const options = [
  { group: 'run', label: 'color: run', value: 'run_id' },
  { group: 'run', label: 'color: project', value: 'project' },
  { group: 'config', label: 'color: config.lr', value: 'config.lr' },
  { group: 'config', label: 'color: config.gpu_hours.192', value: 'config.gpu_hours.192' },
  { group: 'train', label: 'color: loss/[last]', value: 'loss/[last]' },
];

// bits-ui popover portal 残留 → 每轮清空
afterEach(() => {
  document.body.innerHTML = '';
});

async function mountPicker(props: Record<string, unknown>) {
  const target = document.createElement('div');
  document.body.appendChild(target);
  const component = mount(SinglePicker, { target, props: props as never });
  await tick();
  (target.querySelector('[data-slot="popover-trigger"]') as HTMLElement).click();
  await tick();
  await tick();
  return { target, component };
}

describe('SinglePicker', () => {
  it('shows the selected label on the trigger and groups rows under uppercase heads', async () => {
    const target = document.createElement('div');
    document.body.appendChild(target);
    const component = mount(SinglePicker, {
      target,
      props: { options, value: 'config.lr', onValueChange: vi.fn() },
    } as never);
    await tick();
    expect(target.textContent).toContain('color: config.lr');
    (target.querySelector('[data-slot="popover-trigger"]') as HTMLElement).click();
    await tick();
    await tick();
    const groups = [...document.body.querySelectorAll('[data-single-group]')] as HTMLElement[];
    expect(groups.map((g) => g.getAttribute('data-single-group'))).toEqual(['run', 'config', 'train']);
    const head = groups[0].querySelector(':scope > div') as HTMLElement;
    expect(head.querySelector('.uppercase')).toBeTruthy();
    expect(head.querySelector('button[aria-label$="group"]')).toBeTruthy();
    // 当前选中项 radio 打点
    const checked = document.body.querySelector('[data-single-value="config.lr"] input') as HTMLInputElement;
    expect(checked.checked).toBe(true);
    unmount(component);
    target.remove();
  });

  it('picking a row writes the value and closes the panel', async () => {
    const onValueChange = vi.fn();
    const { target, component } = await mountPicker({ options, value: 'run_id', onValueChange });
    const row = document.body.querySelector('[data-single-value="config.lr"] input') as HTMLInputElement;
    row.click();
    await tick();
    expect(onValueChange).toHaveBeenCalledWith('config.lr');
    unmount(component);
    target.remove();
  });

  it('filters rows by search and Collapse/Expand folds the groups', async () => {
    const { target, component } = await mountPicker({ options, value: 'run_id', onValueChange: vi.fn() });
    const tool = (label: string) =>
      [...document.body.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === label)!;
    tool('Collapse').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await tick();
    expect(document.body.querySelector('[data-single-group] label')).toBeNull();
    tool('Expand').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await tick();
    expect(document.body.querySelector('[data-single-group] label')).toBeTruthy();
    const input = document.body.querySelector('input[placeholder="Search..."]') as HTMLInputElement;
    input.value = 'gpu';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await tick();
    const rows = [...document.body.querySelectorAll('[data-single-value]')];
    expect(rows.length).toBe(1);
    expect(rows[0].getAttribute('data-single-value')).toBe('config.gpu_hours.192');
    unmount(component);
    target.remove();
  });
});

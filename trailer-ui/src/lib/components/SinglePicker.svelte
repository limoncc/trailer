<script lang="ts">
  /**
   * 单选下拉面板 —— 与 MetricPicker/DimPicker 的 flat 变体同款视觉:
   * 大写组头 + chevron 展收 + 原生 radio 行;选中即回写并关闭。
   * 用于 Scatter/Pair 的 x/y/color 轴选择(替代原生 select)。
   */
  import * as Popover from '$lib/components/ui/popover';
  import * as Command from '$lib/components/ui/command';
  import { ChevronDown, ChevronRight } from 'lucide-svelte';
  import { cn } from '$lib/utils.js';

  export interface SingleOpt {
    /** 分组名(按传入顺序首现分组,显示时大写) */
    group: string;
    label: string;
    value: string;
  }

  interface Props {
    options: SingleOpt[];
    value: string;
    onValueChange: (v: string) => void;
    /** trigger 文本缺省 = 当前选中项的 label */
    placeholder?: string;
    triggerClass?: string;
    contentClass?: string;
  }

  let {
    options,
    value,
    onValueChange,
    placeholder,
    triggerClass = '',
    contentClass = '',
  }: Props = $props();

  let open = $state(false);
  let query = $state('');
  let collapsed = $state<Set<string>>(new Set());

  const groups = $derived.by(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? options.filter((o) => o.label.toLowerCase().includes(q) || o.group.toLowerCase().includes(q))
      : options;
    const out: Array<{ group: string; items: SingleOpt[] }> = [];
    for (const o of filtered) {
      const last = out[out.length - 1];
      if (last && last.group === o.group) last.items.push(o);
      else out.push({ group: o.group, items: [o] });
    }
    return out;
  });

  const selectedLabel = $derived(options.find((o) => o.value === value)?.label ?? placeholder ?? value);

  function pick(v: string) {
    onValueChange(v);
    open = false;
  }

  function toggleCollapse(key: string) {
    const next = new Set(collapsed);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    collapsed = next;
  }

  function expandAll() {
    collapsed = new Set();
  }

  function collapseAll() {
    collapsed = new Set(groups.map((g) => g.group));
  }

  function expandOneLevel() {
    collapsed = new Set(); // 单层分组,1 level = 全展开
  }
</script>

<Popover.Root bind:open>
  <Popover.Trigger
    class={cn(
      'inline-flex items-center gap-1 px-2 py-1 border border-border rounded-md hover:bg-accent/50 text-xs max-w-56',
      triggerClass,
    )}
  >
    <span class="truncate">{selectedLabel}</span>
    <ChevronDown class="size-3.5 shrink-0" />
  </Popover.Trigger>

  <Popover.Content align="start" class={cn('w-72 p-0', contentClass)}>
    <Command.Root shouldFilter={false}>
      <Command.Input bind:value={query} placeholder="Search..." autofocus />
      <div class="flex items-center gap-2 border-b border-border px-2 py-1 text-[10px] text-muted-foreground">
        <button type="button" class="underline hover:text-foreground" onclick={expandAll}>Expand</button>
        <button type="button" class="underline hover:text-foreground" onclick={collapseAll}>Collapse</button>
        <button type="button" class="underline hover:text-foreground" onclick={expandOneLevel}>Expand 1 level</button>
      </div>
      <Command.List class="max-h-56 overflow-y-auto">
        {#each groups as g (g.group)}
          <div data-single-group={g.group}>
            <div class="flex items-center gap-1 px-2 pt-2 pb-1">
              <button
                type="button"
                class="rounded p-0.5 hover:bg-accent shrink-0"
                aria-label={collapsed.has(g.group) && !query ? 'Expand group' : 'Collapse group'}
                onclick={() => toggleCollapse(g.group)}
              >
                <ChevronRight class="size-3 transition-transform {collapsed.has(g.group) && !query ? '-rotate-90' : ''}" />
              </button>
              <div class="text-[11px] uppercase tracking-wide text-muted-foreground font-mono">{g.group}</div>
            </div>
            {#if !collapsed.has(g.group) || query}
              {#each g.items as o (o.value)}
                <label
                  class="flex items-center gap-2 px-2 py-1 rounded hover:bg/accent/50 cursor-pointer text-xs font-mono"
                  data-single-value={o.value}
                >
                  <input type="radio" name="single-picker" checked={o.value === value} onchange={() => pick(o.value)} />
                  <span class="truncate">{o.label}</span>
                </label>
              {/each}
            {/if}
          </div>
        {:else}
          <p class="py-6 text-center text-sm text-muted-foreground">No matching options</p>
        {/each}
      </Command.List>
    </Command.Root>
  </Popover.Content>
</Popover.Root>

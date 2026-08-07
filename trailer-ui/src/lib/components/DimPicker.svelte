<script lang="ts">
  import * as Popover from '$lib/components/ui/popover';
  import * as Command from '$lib/components/ui/command';
  import { Checkbox } from '$lib/components/ui/checkbox';
  import { ChevronDown, ChevronRight, X } from 'lucide-svelte';
  import { cn } from '$lib/utils.js';
  import { scalarAxisName, parseSummaryKey, type ScalarAxis } from '$lib/utils/explore';

  export interface DimOption {
    axis: ScalarAxis;
    label: string;
  }

  interface DimGroup {
    key: string;
    label: string;
    items: DimOption[];
  }

  interface Props {
    options: DimOption[];
    value: ScalarAxis[];
    onValueChange: (dims: ScalarAxis[]) => void;
    placeholder?: string;
    triggerClass?: string;
    contentClass?: string;
  }

  let {
    options,
    value,
    onValueChange,
    placeholder = 'Dimensions',
    triggerClass = '',
    contentClass = '',
  }: Props = $props();

  let open = $state(false);
  let query = $state('');
  let collapsed = $state<Set<string>>(new Set());

  const GROUP_ORDER = ['config', 'root', 'train', 'val', 'test', 'system'];

  function dimId(axis: ScalarAxis): string {
    return scalarAxisName(axis);
  }

  function dimGroupKey(axis: ScalarAxis): string {
    if (axis.kind === 'config') return 'config';
    const { context } = parseSummaryKey(axis.summaryKey);
    return context === '' ? 'root' : context.split('/')[0];
  }

  function groupLabel(key: string): string {
    return key === 'root' ? 'root' : key;
  }

  const filtered = $derived(
    query.trim() ? options.filter((o) => o.label.toLowerCase().includes(query.trim().toLowerCase())) : options,
  );

  const groups = $derived.by(() => {
    const buckets = new Map<string, DimOption[]>();
    for (const o of filtered) {
      const k = dimGroupKey(o.axis);
      const arr = buckets.get(k);
      if (arr) arr.push(o);
      else buckets.set(k, [o]);
    }
    const orderIdx = new Map(GROUP_ORDER.map((name, i) => [name, i]));
    const keys = [...buckets.keys()].sort((a, b) => {
      const ia = orderIdx.get(a);
      const ib = orderIdx.get(b);
      if (ia != null && ib != null) return ia - ib;
      if (ia != null) return -1;
      if (ib != null) return 1;
      return a.localeCompare(b);
    });
    const out: DimGroup[] = [];
    for (const k of keys) {
      const items = buckets.get(k)!;
      items.sort((a, b) => a.label.localeCompare(b.label));
      out.push({ key: k, label: groupLabel(k), items });
    }
    return out;
  });

  const selectedIds = $derived(new Set(value.map((d) => dimId(d))));

  function has(axis: ScalarAxis): boolean {
    return selectedIds.has(dimId(axis));
  }

  function toggle(axis: ScalarAxis) {
    const id = dimId(axis);
    if (has(axis)) {
      onValueChange(value.filter((d) => dimId(d) !== id));
    } else {
      onValueChange([...value, axis]);
    }
  }

  function toggleGroup(g: DimGroup) {
    const allSelected = g.items.every((o) => selectedIds.has(dimId(o.axis)));
    if (allSelected) {
      const remove = new Set(g.items.map((o) => dimId(o.axis)));
      onValueChange(value.filter((d) => !remove.has(dimId(d))));
    } else {
      const current = new Set(value.map((d) => dimId(d)));
      const add = g.items.filter((o) => !current.has(dimId(o.axis))).map((o) => o.axis);
      onValueChange([...value, ...add]);
    }
  }

  function selectAll() {
    const current = new Set(value.map((d) => dimId(d)));
    const add = filtered.filter((o) => !current.has(dimId(o.axis))).map((o) => o.axis);
    onValueChange([...value, ...add]);
  }

  function clearAll() {
    onValueChange([]);
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
    collapsed = new Set(groups.map((g) => g.key));
  }
</script>

<Popover.Root bind:open>
  <Popover.Trigger
    class={cn(
      'inline-flex items-center gap-1 px-2 py-1 border border-border rounded-md hover:bg-accent/50 text-xs',
      triggerClass,
    )}
  >
    {placeholder} ({value.length}/{options.length})
    <ChevronDown class="size-3.5" />
  </Popover.Trigger>

  <Popover.Content align="start" class={cn('w-72 p-0', contentClass)}>
    <Command.Root shouldFilter={false}>
      <Command.Input bind:value={query} placeholder="Search dimensions..." autofocus />
      <div class="flex items-center gap-2 border-b border-border px-2 py-1 text-[10px] text-muted-foreground">
        <button type="button" class="underline hover:text-foreground" onclick={selectAll}>All</button>
        <button type="button" class="underline hover:text-foreground" onclick={clearAll}>None</button>
        <button type="button" class="underline hover:text-foreground" onclick={expandAll}>Expand</button>
        <button type="button" class="underline hover:text-foreground" onclick={collapseAll}>Collapse</button>
      </div>
      <Command.List class="max-h-56 overflow-y-auto">
        {#each groups as g (g.key)}
          {@const selCount = g.items.filter((o) => selectedIds.has(dimId(o.axis))).length}
          {@const gs = { all: selCount === g.items.length && g.items.length > 0, some: selCount > 0 && selCount < g.items.length, none: selCount === 0 }}
          <div class="py-0.5">
            <div class="flex items-center gap-1 px-2 py-1">
              <button
                type="button"
                class="rounded p-0.5 hover:bg-accent"
                aria-label={collapsed.has(g.key) && !query ? 'Expand group' : 'Collapse group'}
                onclick={() => toggleCollapse(g.key)}
              >
                <ChevronRight class="size-3 transition-transform {collapsed.has(g.key) && !query ? '-rotate-90' : ''}" />
              </button>
              <button
                type="button"
                class="flex-1 text-left text-xs font-semibold text-muted-foreground hover:text-foreground"
                onclick={() => toggleGroup(g)}
              >
                {g.label} <span class="text-[10px] font-normal">({g.items.length})</span>
              </button>
              <Checkbox
                checked={gs.all}
                indeterminate={gs.some}
                onCheckedChange={() => toggleGroup(g)}
              />
            </div>
            {#if !collapsed.has(g.key) || query}
              {#each g.items as o (dimId(o.axis))}
                {@const on = selectedIds.has(dimId(o.axis))}
                <Command.Item value={dimId(o.axis)} data-checked={on} onSelect={() => toggle(o.axis)} class="pl-6 text-xs">
                  <span class="truncate">{o.label}</span>
                </Command.Item>
              {/each}
            {/if}
          </div>
        {/each}
        {#if groups.length === 0}
          <p class="py-6 text-center text-sm text-muted-foreground">No matching dimensions</p>
        {/if}
      </Command.List>
      {#if value.length > 0}
        <div class="flex max-h-28 items-center gap-1 border-t border-border px-2 py-1.5 text-[10px] text-muted-foreground">
          <span>Selected ({value.length})</span>
          <button type="button" class="ml-auto underline hover:text-foreground" onclick={clearAll}>Clear all</button>
        </div>
        <div class="max-h-32 overflow-y-auto px-1 pb-1">
          {#each value as d (dimId(d))}
            <div class="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs hover:bg-accent">
              <span class="min-w-0 flex-1 truncate">{options.find((o) => dimId(o.axis) === dimId(d))?.label ?? scalarAxisName(d)}</span>
              <button
                type="button"
                class="shrink-0 rounded p-0.5 hover:bg-accent/70 hover:text-destructive"
                aria-label={`Remove ${options.find((o) => dimId(o.axis) === dimId(d))?.label ?? scalarAxisName(d)}`}
                onclick={(e) => {
                  e.stopPropagation();
                  toggle(d);
                }}
              >
                <X class="size-3" />
              </button>
            </div>
          {/each}
        </div>
      {/if}
    </Command.Root>
  </Popover.Content>
</Popover.Root>

<script lang="ts">
  import * as Popover from '$lib/components/ui/popover';
  import * as Command from '$lib/components/ui/command';
  import { Checkbox } from '$lib/components/ui/checkbox';
  import { ChevronDown, ChevronRight, X } from 'lucide-svelte';
  import { cn } from '$lib/utils.js';
  import type { MetricRef } from '$lib/utils/explore';
  import {
    metricId,
    groupMetricsByContext,
    filterMetrics,
    selectionState,
    type MetricOption,
  } from '$lib/utils/metricGroups';

  interface Props {
    options: MetricOption[];
    value: MetricRef[];
    onValueChange: (next: MetricRef[]) => void;
    placeholder?: string;
    formatLabel?: (m: MetricRef) => string;
    rootLabel?: string;
    groupOrder?: string[];
    triggerClass?: string;
    contentClass?: string;
  }

  let {
    options,
    value,
    onValueChange,
    placeholder = 'Metrics',
    formatLabel = (m) => (m.context ? `${m.key} [${m.context}]` : m.key),
    rootLabel = 'root',
    groupOrder,
    triggerClass = '',
    contentClass = '',
  }: Props = $props();

  let open = $state(false);
  let query = $state('');
  let collapsed = $state<Set<string>>(new Set());

  const selectedIds = $derived(new Set(value.map((m) => metricId(m))));
  const filtered = $derived(query.trim() ? filterMetrics(options, query.trim()) : options);
  const groups = $derived(groupMetricsByContext(filtered, { rootLabel, order: groupOrder }));

  function has(m: MetricRef): boolean {
    return selectedIds.has(metricId(m));
  }

  function toggle(m: MetricRef) {
    if (has(m)) {
      onValueChange(value.filter((x) => !(x.key === m.key && x.context === m.context)));
    } else {
      onValueChange([...value, { key: m.key, context: m.context }]);
    }
  }

  function toggleGroup(ctx: string) {
    const group = groups.find((g) => g.context === ctx);
    if (!group || group.items.length === 0) return;
    const allSelected = group.items.every((o) => selectedIds.has(metricId(o)));
    if (allSelected) {
      const remove = new Set(group.items.map((o) => metricId(o)));
      onValueChange(value.filter((x) => !remove.has(metricId(x))));
    } else {
      const current = new Set(value.map((m) => metricId(m)));
      const add = group.items.filter((o) => !current.has(metricId(o))).map((o) => ({ key: o.key, context: o.context }));
      onValueChange([...value, ...add]);
    }
  }

  function selectAll() {
    const current = new Set(value.map((m) => metricId(m)));
    const add = filtered.filter((o) => !current.has(metricId(o))).map((o) => ({ key: o.key, context: o.context }));
    onValueChange([...value, ...add]);
  }

  function clearAll() {
    onValueChange([]);
  }

  function toggleCollapse(ctx: string) {
    const next = new Set(collapsed);
    if (next.has(ctx)) next.delete(ctx);
    else next.add(ctx);
    collapsed = next;
  }

  function expandAll() {
    collapsed = new Set();
  }

  function collapseAll() {
    collapsed = new Set(groups.map((g) => g.context));
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
      <Command.Input bind:value={query} placeholder="Search metrics..." autofocus />
      <div class="flex items-center gap-2 border-b border-border px-2 py-1 text-[10px] text-muted-foreground">
        <button type="button" class="underline hover:text-foreground" onclick={selectAll}>All</button>
        <button type="button" class="underline hover:text-foreground" onclick={clearAll}>None</button>
        <button type="button" class="underline hover:text-foreground" onclick={expandAll}>Expand</button>
        <button type="button" class="underline hover:text-foreground" onclick={collapseAll}>Collapse</button>
      </div>
      <Command.List class="max-h-56 overflow-y-auto">
        {#each groups as g (g.context)}
          {@const gs = selectionState(g.items, selectedIds)}
          <div class="py-0.5">
            <div class="flex items-center gap-1 px-2 py-1">
              <button
                type="button"
                class="rounded p-0.5 hover:bg-accent"
                aria-label={collapsed.has(g.context) && !query ? 'Expand group' : 'Collapse group'}
                onclick={() => toggleCollapse(g.context)}
              >
                <ChevronRight class="size-3 transition-transform {collapsed.has(g.context) && !query ? '-rotate-90' : ''}" />
              </button>
              <button
                type="button"
                class="flex-1 text-left text-xs font-semibold text-muted-foreground hover:text-foreground"
                onclick={() => toggleGroup(g.context)}
              >
                {g.label} <span class="text-[10px] font-normal">({g.items.length})</span>
              </button>
              <Checkbox
                checked={gs.all}
                indeterminate={gs.some}
                onCheckedChange={() => toggleGroup(g.context)}
              />
            </div>
            {#if !collapsed.has(g.context) || query}
              {#each g.items as o (metricId(o))}
                {@const on = selectedIds.has(metricId(o))}
                <Command.Item value={metricId(o)} data-checked={on} onSelect={() => toggle(o)} class="pl-6 text-xs">
                  <span class="truncate">{formatLabel(o)}</span>
                  {#if o.count != null}
                    <span class="ml-auto shrink-0 text-muted-foreground">{o.count}</span>
                  {/if}
                </Command.Item>
              {/each}
            {/if}
          </div>
        {/each}
        {#if groups.length === 0}
          <p class="py-6 text-center text-sm text-muted-foreground">No matching metrics</p>
        {/if}
      </Command.List>
      {#if value.length > 0}
        <div class="flex max-h-28 items-center gap-1 border-t border-border px-2 py-1.5 text-[10px] text-muted-foreground">
          <span>Selected ({value.length})</span>
          <button type="button" class="ml-auto underline hover:text-foreground" onclick={clearAll}>Clear all</button>
        </div>
        <div class="max-h-32 overflow-y-auto px-1 pb-1">
          {#each value as m (metricId(m))}
            <div class="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs hover:bg-accent">
              <span class="min-w-0 flex-1 truncate">{formatLabel(m)}</span>
              <button
                type="button"
                class="shrink-0 rounded p-0.5 hover:bg-accent/70 hover:text-destructive"
                aria-label={`Remove ${formatLabel(m)}`}
                onclick={(e) => {
                  e.stopPropagation();
                  toggle(m);
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

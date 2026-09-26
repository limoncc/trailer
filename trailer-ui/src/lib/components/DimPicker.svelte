<script lang="ts">
  import * as Popover from '$lib/components/ui/popover';
  import * as Command from '$lib/components/ui/command';
  import { Checkbox } from '$lib/components/ui/checkbox';
  import { ChevronDown, ChevronRight, X } from 'lucide-svelte';
  import { cn } from '$lib/utils.js';
  import { scalarAxisName, parseSummaryKey, type ScalarAxis } from '$lib/utils/explore';
  import {
    buildPathTree,
    type PathTreeDir,
    type PathTreeNode,
  } from '$lib/utils/metricGroups';

  export interface DimOption {
    axis: ScalarAxis;
    label: string;
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

  const GROUP_ORDER = ['config', 'root', 'train', 'val', 'eval', 'test', 'system'];

  function dimId(axis: ScalarAxis): string {
    return scalarAxisName(axis);
  }

  /** 路径段:config 点号分段,summary 按 context 斜杠分段(最后一级是叶) */
  function segsOf(o: DimOption): string[] {
    if (o.axis.kind === 'config') {
      const parts = o.axis.path.split('.');
      return ['config', ...parts.slice(0, -1)];
    }
    const { context } = parseSummaryKey(o.axis.summaryKey);
    return context ? context.split('/') : ['root'];
  }

  /** 叶子文本:路径由目录表达,只留最后一级 */
  function leafLabel(o: DimOption): string {
    if (o.axis.kind === 'config') return o.axis.path.split('.').pop()!;
    const { key } = parseSummaryKey(o.axis.summaryKey);
    return `${key}.${o.axis.field}`;
  }

  const filtered = $derived(
    query.trim() ? options.filter((o) => o.label.toLowerCase().includes(query.trim().toLowerCase())) : options,
  );
  const tree = $derived(buildPathTree(filtered, segsOf, leafLabel, { rootLabel: 'root', order: GROUP_ORDER }));

  const selectedIds = $derived(new Set(value.map((d) => dimId(d))));

  function collectDirKeys(nodes: PathTreeNode<DimOption>[], out: Set<string>): void {
    for (const n of nodes) {
      if (n.type === 'dir') {
        out.add(n.path);
        collectDirKeys(n.children, out);
      }
    }
  }
  const allDirKeys = $derived.by(() => {
    const s = new Set<string>();
    collectDirKeys(tree, s);
    return s;
  });

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

  /** 目录:子树全选/全不选(混合态 → 补齐全选) */
  /** 目录三态(DimOption 无 key/context,不能用通用 selectionState) */
  function dirState(dir: PathTreeDir<DimOption>): { all: boolean; some: boolean; none: boolean } {
    if (dir.items.length === 0) return { all: false, some: false, none: true };
    const n = dir.items.filter((o) => selectedIds.has(dimId(o.axis))).length;
    return { all: n === dir.items.length, some: n > 0 && n < dir.items.length, none: n === 0 };
  }

  function toggleDir(dir: PathTreeDir<DimOption>) {
    const allSelected = dir.items.every((o) => selectedIds.has(dimId(o.axis)));
    if (allSelected) {
      const remove = new Set(dir.items.map((o) => dimId(o.axis)));
      onValueChange(value.filter((d) => !remove.has(dimId(d))));
    } else {
      const current = new Set(value.map((d) => dimId(d)));
      const add = dir.items.filter((o) => !current.has(dimId(o.axis))).map((o) => o.axis);
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
    collapsed = new Set(allDirKeys);
  }
</script>

{#snippet dirHeader(
  label: string,
  count: number,
  key: string,
  gs: { all: boolean; some: boolean },
  onToggle: () => void,
  depth: number
)}
  <div class="flex items-center gap-1 py-1" style="padding-left: {8 + depth * 14}px; padding-right: 8px">
    <button
      type="button"
      class="rounded p-0.5 hover:bg-accent"
      aria-label={collapsed.has(key) && !query ? 'Expand group' : 'Collapse group'}
      onclick={() => toggleCollapse(key)}
    >
      <ChevronRight class="size-3 transition-transform {collapsed.has(key) && !query ? '-rotate-90' : ''}" />
    </button>
    <button
      type="button"
      class="flex-1 text-left text-xs font-semibold text-muted-foreground hover:text-foreground"
      onclick={onToggle}
    >
      {label} <span class="text-[10px] font-normal">({count})</span>
    </button>
    <Checkbox checked={gs.all} indeterminate={gs.some} onCheckedChange={onToggle} />
  </div>
{/snippet}

        {#snippet node(n: PathTreeNode<DimOption>, depth: number)}
          {#if n.type === 'dir'}
            {@const gs = dirState(n)}
            <div class="py-0.5" data-tree-dir data-tree-path={n.path} data-tree-depth={depth}>
              {@render dirHeader(n.label, n.items.length, n.path, gs, () => toggleDir(n), depth)}
              {#if !collapsed.has(n.path) || query}
                {#each n.children as c (c.type === 'dir' ? `d:${c.path}` : `l:${dimId(c.item.axis)}`)}
                  {@render node(c, depth + 1)}
                {/each}
              {/if}
            </div>
          {:else}
            {@const o = n.item}
            <Command.Item
              value={dimId(o.axis)}
              data-checked={has(o.axis)}
              data-tree-leaf
              data-dim-id={dimId(o.axis)}
              data-tree-depth={depth}
              onSelect={() => toggle(o.axis)}
              class="text-xs"
              style="padding-left: {8 + depth * 14}px"
            >
              <span class="truncate">{n.label}</span>
            </Command.Item>
          {/if}
        {/snippet}

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
        {#each tree as n (n.type === 'dir' ? `d:${n.path}` : `l:${dimId(n.item.axis)}`)}
          {@render node(n, 0)}
        {/each}
        {#if tree.length === 0}
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

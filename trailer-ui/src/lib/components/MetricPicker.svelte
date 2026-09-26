<script lang="ts">
  import * as Popover from '$lib/components/ui/popover';
  import * as Command from '$lib/components/ui/command';
  import { Checkbox } from '$lib/components/ui/checkbox';
  import { ChevronDown, ChevronRight, X } from 'lucide-svelte';
  import { cn } from '$lib/utils.js';
  import type { MetricRef, MetricSel } from '$lib/utils/explore';
  import {
    metricId,
    buildPathTree,
    groupMetricsByContext,
    filterMetrics,
    selectionState,
    type MetricOption,
    type PathTreeDir,
    type PathTreeNode,
  } from '$lib/utils/metricGroups';

  interface Props {
    options: MetricOption[];
    value: MetricSel[];
    onValueChange: (next: MetricSel[]) => void;
    placeholder?: string;
    formatLabel?: (m: MetricRef) => string;
    /** 树内叶子文本(路径由目录表达);缺省 = formatLabel */
    formatLeaf?: (m: MetricRef) => string;
    /** 已选区(Selected)chips 文本;缺省 = formatLabel。可带上 run 列表以便区分同名 run */
    formatChip?: (m: MetricSel) => string;
    /** run 显示名;owners 存在时指标变目录、run 作叶子(勾选细化到 run) */
    runLabelOf?: (runId: string) => string;
    rootLabel?: string;
    groupOrder?: string[];
    /** tree = 层级折叠树(默认);flat = Boards Add Chart 同款(大写组头 + 原生 checkbox,勾选后展开 run 行) */
    variant?: 'tree' | 'flat';
    triggerClass?: string;
    contentClass?: string;
  }

  let {
    options,
    value,
    onValueChange,
    placeholder = 'Metrics',
    formatLabel = (m) => (m.context ? `${m.key} [${m.context}]` : m.key),
    formatLeaf,
    formatChip,
    runLabelOf,
    rootLabel = 'root',
    groupOrder,
    variant = 'tree',
    triggerClass = '',
    contentClass = '',
  }: Props = $props();

  let open = $state(false);
  let query = $state('');
  let collapsed = $state<Set<string>>(new Set());

  const leafFormat = $derived(formatLeaf ?? formatLabel);
  const chipFormat = $derived(formatChip ?? formatLabel);
  const selectedIds = $derived(new Set(value.map((m) => metricId(m))));
  const filtered = $derived(query.trim() ? filterMetrics(options, query.trim()) : options);
  const tree = $derived(
    buildPathTree(filtered, (m) => (m.context ? m.context.split('/') : []), (m) => leafFormat(m), {
      rootLabel,
      order: groupOrder,
    })
  );

  /** flat 变体:与 Boards Add Chart 相同的首段分组(groupMetricsByContext) */
  const flatGroups = $derived(
    groupMetricsByContext(filtered, { rootLabel, order: groupOrder })
  );

  /** 该指标的该 run 是否被勾选(undefined run_ids = 全部) */
  function runOn(m: { key: string; context: string }, runId: string): boolean {
    const e = entryOf(m);
    return e !== undefined && (!e.run_ids || e.run_ids.includes(runId));
  }

  /** 指标升级目录的 key(与 buildPathTree 的 path 分空间,防撞) */
  function metricDirKey(m: { key: string; context: string }): string {
    return `m:${metricId(m)}`;
  }

  function childKey(n: PathTreeNode<MetricOption>): string {
    return n.type === 'dir' ? `d:${n.path}` : `l:${metricId(n.item)}`;
  }

  /** collectDirKeys 收集 tree 的全部可折 key(目录 + 升级为目录的指标) */
  function collectDirKeys(nodes: PathTreeNode<MetricOption>[], out: Set<string>): void {
    for (const n of nodes) {
      if (n.type === 'dir') {
        out.add(n.path);
        collectDirKeys(n.children, out);
      } else if (n.item.owners && n.item.owners.length > 0) {
        out.add(metricDirKey(n.item));
      }
    }
  }
  /** 当前视图全部可折 key(Collapse 用):flat = 组 + 已勾指标的 run 行 */
  const allFoldKeys = $derived.by(() => {
    const s = new Set<string>();
    if (variant === 'flat') {
      for (const g of flatGroups) {
        s.add(g.context);
        for (const m of g.items) if (entryOf(m)) s.add(metricDirKey(m));
      }
    } else {
      collectDirKeys(tree, s);
    }
    return s;
  });

  /** Expand 1 level:顶层组展开,更深层目录与指标 run 行收起 */
  const deepFoldKeys = $derived.by(() => {
    const s = new Set<string>();
    if (variant === 'flat') {
      for (const g of flatGroups) for (const m of g.items) if (entryOf(m)) s.add(metricDirKey(m));
    } else {
      const walk = (nodes: PathTreeNode<MetricOption>[], depth: number) => {
        for (const n of nodes) {
          if (n.type === 'dir') {
            if (depth >= 1) s.add(n.path);
            walk(n.children, depth + 1);
          } else if (n.item.owners && n.item.owners.length > 0) {
            s.add(metricDirKey(n.item));
          }
        }
      };
      walk(tree, 0);
    }
    return s;
  });

  function entryOf(m: { key: string; context: string }): MetricSel | undefined {
    return value.find((x) => x.key === m.key && x.context === m.context);
  }

  /** 指标行三态:勾 = 指标在卡中(entry 存在,含零 run 待挑);
   *  横杠 = 部分 run(0 < 勾中 < owners);无 entry = 空。
   *  undefined run_ids(旧数据)视为全部已勾。 */
  function metricRunState(m: MetricOption): { all: boolean; some: boolean; none: boolean } {
    const e = entryOf(m);
    if (!e) return { all: false, some: false, none: true };
    if (!e.run_ids) return { all: true, some: false, none: false };
    const owners = m.owners ?? [];
    const n = owners.filter((o) => e.run_ids!.includes(o)).length;
    if (n === 0) return { all: true, some: false, none: false }; // 零勾选:指标已加入,等手动挑
    if (owners.length === 0 || n >= owners.length) return { all: true, some: false, none: false };
    return { all: false, some: true, none: false };
  }

  /** 新加入指标:**默认一个 run 都不勾**(手动挑);无 run 层的纯指标直接选中 */
  function addEntry(m: MetricOption): MetricSel {
    return m.owners && m.owners.length > 0
      ? { key: m.key, context: m.context, run_ids: [] }
      : { key: m.key, context: m.context };
  }

  function restWithout(m: { key: string; context: string }): MetricSel[] {
    return value.filter((x) => !(x.key === m.key && x.context === m.context));
  }

  /** 勾选/取消指标:首次勾选默认零 run(手动挑哪个画哪个),再点移除 */
  function toggleLeaf(m: MetricOption) {
    toggleMetricDir(m);
  }

  /** 指标行/目录:点一下加入(零 run)或移除 */
  function toggleMetricDir(m: MetricOption) {
    if (entryOf(m)) {
      onValueChange(restWithout(m));
      return;
    }
    onValueChange([...value, addEntry(m)]);
    // 勾选后自动展开 run 行(手动挑 run 才看得见)
    const k = metricDirKey(m);
    if (collapsed.has(k)) {
      const next = new Set(collapsed);
      next.delete(k);
      collapsed = next;
    }
  }

  /** run 叶:在该指标的 run 集合里增删;收敛到全选 → 缺省,删空 → 移除指标 */
  function toggleRun(m: MetricOption, runId: string) {
    const owners = m.owners ?? [];
    const rest = restWithout(m);
    const e = entryOf(m);
    let next: string[];
    if (!e) next = [runId];
    else if (!e.run_ids) next = owners.filter((o) => o !== runId);
    else next = e.run_ids.includes(runId) ? e.run_ids.filter((x) => x !== runId) : [...e.run_ids, runId];
    const cleaned = next.filter((o) => owners.includes(o));
    if (cleaned.length === owners.length) onValueChange([...rest, { key: m.key, context: m.context }]);
    else onValueChange([...rest, { key: m.key, context: m.context, run_ids: cleaned }]); // 含空数组 = 零勾选,指标保留
  }

  /** context 目录:按指标级整组全选/全不选(run 细化在指标层做) */
  function toggleDirItems(dir: PathTreeDir<MetricOption>) {
    const allSelected = dir.items.every((o) => selectedIds.has(metricId(o)));
    if (allSelected) {
      const remove = new Set(dir.items.map((o) => metricId(o)));
      onValueChange(value.filter((x) => !remove.has(metricId(x))));
    } else {
      const current = new Set(value.map((m) => metricId(m)));
      const add = dir.items.filter((o) => !current.has(metricId(o))).map((o) => ({ key: o.key, context: o.context }));
      onValueChange([...value, ...add]);
    }
  }

  function selectAll() {
    const current = new Set(value.map((m) => metricId(m)));
    const add = filtered.filter((o) => !current.has(metricId(o))).map((o) => addEntry(o));
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
    collapsed = new Set(allFoldKeys);
  }

  function expandOneLevel() {
    collapsed = new Set(deepFoldKeys);
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

        {#snippet node(n: PathTreeNode<MetricOption>, depth: number)}
          {#if n.type === 'dir'}
            {@const gs = selectionState(n.items, selectedIds)}
            <div class="py-0.5" data-tree-dir data-tree-path={n.path} data-tree-depth={depth}>
              {@render dirHeader(n.label, n.items.length, n.path, gs, () => toggleDirItems(n), depth)}
              {#if !collapsed.has(n.path) || query}
                {#each n.children as c (childKey(c))}
                  {@render node(c, depth + 1)}
                {/each}
              {/if}
            </div>
          {:else if n.item.owners && n.item.owners.length > 0}
            <!-- 指标 → run 层:owners 存在时指标升级为目录,run 是叶子(先选指标,再选 run) -->
            {@const m = n.item}
            {@const owners = m.owners ?? []}
            {@const key = metricDirKey(m)}
            {@const gs = metricRunState(m)}
            <div class="py-0.5" data-tree-dir data-metric-id={metricId(m)} data-tree-depth={depth}>
              {@render dirHeader(leafFormat(m), owners.length, key, gs, () => toggleMetricDir(m), depth)}
              {#if !collapsed.has(key) || query}
                {#each owners as runId (runId)}
                  {@const on = entryOf(m) !== undefined && (!entryOf(m)?.run_ids || entryOf(m)!.run_ids!.includes(runId))}
                  <Command.Item
                    value={`${metricId(m)}::${runId}`}
                    data-checked={on}
                    data-tree-leaf
                    data-tree-run={runId}
                    data-metric-id={metricId(m)}
                    data-tree-depth={depth + 1}
                    onSelect={() => toggleRun(m, runId)}
                    class="text-xs"
                    style="padding-left: {8 + (depth + 1) * 14}px"
                  >
                    <span class="truncate">{runLabelOf ? runLabelOf(runId) : runId}</span>
                  </Command.Item>
                {/each}
              {/if}
            </div>
          {:else}
            {@const m = n.item}
            <Command.Item
              value={metricId(m)}
              data-checked={selectedIds.has(metricId(m))}
              data-tree-leaf
              data-metric-id={metricId(m)}
              data-tree-depth={depth}
              onSelect={() => toggleLeaf(m)}
              class="text-xs"
              style="padding-left: {8 + depth * 14}px"
            >
              <span class="truncate">{n.label}</span>
              {#if m.count != null}
                <span class="ml-auto shrink-0 text-muted-foreground">{m.count}</span>
              {/if}
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
      <Command.Input bind:value={query} placeholder="Search metrics..." autofocus />
      <div class="flex items-center gap-2 border-b border-border px-2 py-1 text-[10px] text-muted-foreground">
        <button type="button" class="underline hover:text-foreground" onclick={selectAll}>All</button>
        <button type="button" class="underline hover:text-foreground" onclick={clearAll}>None</button>
        <button type="button" class="underline hover:text-foreground" onclick={expandAll}>Expand</button>
        <button type="button" class="underline hover:text-foreground" onclick={collapseAll}>Collapse</button>
        <button type="button" class="underline hover:text-foreground" onclick={expandOneLevel}>Expand 1 level</button>
      </div>
      <Command.List class="max-h-56 overflow-y-auto">
        {#if variant === 'flat'}
          {#each flatGroups as g (g.context)}
            <div data-metric-group={g.context}>
              <div class="flex items-center gap-1 px-2 pt-2 pb-1">
                <button
                  type="button"
                  class="rounded p-0.5 hover:bg-accent shrink-0"
                  aria-label={collapsed.has(g.context) && !query ? 'Expand group' : 'Collapse group'}
                  onclick={() => toggleCollapse(g.context)}
                >
                  <ChevronRight class="size-3 transition-transform {collapsed.has(g.context) && !query ? '-rotate-90' : ''}" />
                </button>
                <div class="text-[11px] uppercase tracking-wide text-muted-foreground font-mono">
                  {g.label}
                </div>
              </div>
              {#if !collapsed.has(g.context) || query}
                {#each g.items as m (metricId(m))}
                  {@const st = metricRunState(m)}
                  {@const mkey = metricDirKey(m)}
                  <div data-metric-id={metricId(m)}>
                    <div class="flex items-center">
                      {#if entryOf(m)}
                        <button
                          type="button"
                          class="rounded p-0.5 hover:bg-accent shrink-0"
                          aria-label={collapsed.has(mkey) && !query ? 'Expand group' : 'Collapse group'}
                          onclick={() => toggleCollapse(mkey)}
                        >
                          <ChevronRight class="size-3 transition-transform {collapsed.has(mkey) && !query ? '-rotate-90' : ''}" />
                        </button>
                      {:else}
                        <span class="w-5 shrink-0"></span>
                      {/if}
                      <label class="flex-1 flex items-center gap-2 px-2 py-1 rounded hover:bg-accent/50 cursor-pointer text-xs font-mono">
                        <input
                          type="checkbox"
                          checked={st.all}
                          indeterminate={st.some}
                          onchange={() => toggleMetricDir(m)}
                        />
                        <span class="truncate">{formatLabel(m)}</span>
                      </label>
                    </div>
                    {#if entryOf(m) && (!collapsed.has(mkey) || query)}
                      {#each (m.owners ?? []) as runId (runId)}
                        <label
                          data-tree-run={runId}
                          class="flex items-center gap-2 pl-10 pr-2 py-1 rounded hover:bg-accent/50 cursor-pointer text-xs"
                        >
                          <input
                            type="checkbox"
                            checked={runOn(m, runId)}
                            onchange={() => toggleRun(m, runId)}
                          />
                          <span class="truncate">{runLabelOf ? runLabelOf(runId) : runId}</span>
                        </label>
                      {/each}
                    {/if}
                  </div>
                {/each}
              {/if}
            </div>
          {:else}
            <p class="py-6 text-center text-sm text-muted-foreground">No matching metrics</p>
          {/each}
        {:else}
          {#each tree as n (childKey(n))}
            {@render node(n, 0)}
          {/each}
        {/if}
        {#if variant !== 'flat' && tree.length === 0}
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
              <span class="min-w-0 flex-1 truncate">{chipFormat(m)}</span>
              <button
                type="button"
                class="shrink-0 rounded p-0.5 hover:bg-accent/70 hover:text-destructive"
                aria-label={`Remove ${chipFormat(m)}`}
                onclick={(e) => {
                  e.stopPropagation();
                  toggleLeaf(m);
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

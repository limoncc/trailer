<script lang="ts">
  import LandscapeCard from './LandscapeCard.svelte';
  import MetricPicker from '$lib/components/MetricPicker.svelte';
  import { refreshInterval } from '$lib/refresh.svelte';
  import { groupLandscapeFigures } from './landscape';
  import type { LandscapeFigureRow, LandscapeGroup } from './landscape';
  import type { MetricRef } from '$lib/utils/explore';

  interface Props { runId: string; }
  let { runId }: Props = $props();

  let rows = $state<LandscapeFigureRow[]>([]);
  let groups = $state<LandscapeGroup[]>([]);
  let loading = $state(true);
  let hidden = $state<Set<string>>(new Set());
  let nameFilter = $state('');
  let columns = $state<1 | 2 | 3 | 4>(2);
  let dragIndex = -1; // 非响应式

  /// Parse comma-separated keywords (support Chinese commas)
  function parseFilter(input: string): string[] {
    return input.split(/[,，]/).map(k => k.trim()).filter(Boolean);
  }

  async function loadLandscapes(refresh = false) {
    if (!refresh) loading = true;
    try {
      const resp = await fetch(`/api/v1/runs/${encodeURIComponent(runId)}/figures`);
      if (resp.ok) {
        const all = await resp.json();
        const lsRows: LandscapeFigureRow[] = all.filter((f: any) => f.kind === 'landscape');
        if (!refresh) {
          rows = lsRows;
          hidden = new Set();
          groups = groupLandscapeFigures(rows);
        } else if (lsRows.length !== rows.length) {
          // 仅在真正出现新帧时才更新——避免 5s 轮询替换数组身份引发全链路无意义重算
          const seen = new Set(rows.map((r) => `${r.name}:${r.step}`));
          const merged = [...rows];
          for (const r of lsRows) {
            const key = `${r.name}:${r.step}`;
            if (!seen.has(key)) { merged.push(r); seen.add(key); }
          }
          rows = merged;
          groups = groupLandscapeFigures(rows);
        }
      }
    } catch {}
    loading = false;
  }

  $effect(() => { if (runId) loadLandscapes(); });

  // 运行中 run 实时刷新：按全局 refreshInterval 轮询增量合并新 step
  $effect(() => {
    if (!runId || $refreshInterval <= 0) return;
    const timer = setInterval(() => loadLandscapes(true), $refreshInterval * 1000);
    return () => clearInterval(timer);
  });

  // MetricPicker 适配：每个 Landscape 组映射为 {key: name, context: ''}
  const groupOptions = $derived(groups.map(g => ({ key: g.name, context: '', count: g.rows.length })));
  const visibleRefs = $derived(groups.filter(g => !hidden.has(g.name)).map(g => ({ key: g.name, context: '' })));

  function onVisibleChange(next: MetricRef[]) {
    const ids = new Set(next.map(m => m.key));
    hidden = new Set(groups.map(g => g.name).filter(n => !ids.has(n)));
  }

  let visible = $derived(groups.filter(g => {
    if (hidden.has(g.name)) return false;
    const keywords = parseFilter(nameFilter);
    if (keywords.length === 0) return true;
    return keywords.some(k => g.name.toLowerCase().includes(k.toLowerCase()));
  }));

  // Drag-and-drop reorder（与 PCAExplorer 同法：重排派生 groups，未知组保持队尾）
  function onDragStart(e: DragEvent, idx: number) {
    dragIndex = idx;
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
  }
  function onDragOver(e: DragEvent, idx: number) {
    e.preventDefault();
    if (dragIndex < 0 || dragIndex === idx) return;
    const arr = [...visible];
    const [moved] = arr.splice(dragIndex, 1);
    arr.splice(idx, 0, moved);
    const reordered = arr.map(g => g.name);
    const seen = new Set<string>();
    const newGroups: LandscapeGroup[] = [];
    for (const name of reordered) {
      const g = groups.find(x => x.name === name);
      if (g) { newGroups.push(g); seen.add(name); }
    }
    for (const g of groups) if (!seen.has(g.name)) newGroups.push(g);
    groups = newGroups;
    dragIndex = idx;
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
  }
  function onDragEnd() { dragIndex = -1; }

  function moveItem(idx: number, dir: -1 | 1) {
    const target = idx + dir;
    if (target < 0 || target >= visible.length) return;
    const arr = [...visible];
    [arr[idx], arr[target]] = [arr[target], arr[idx]];
    const reordered = arr.map(g => g.name);
    const seen = new Set<string>();
    const newGroups: LandscapeGroup[] = [];
    for (const name of reordered) {
      const g = groups.find(x => x.name === name);
      if (g) { newGroups.push(g); seen.add(name); }
    }
    for (const g of groups) if (!seen.has(g.name)) newGroups.push(g);
    groups = newGroups;
  }
</script>

<div class="w-full">
  {#if loading}
    <div class="text-center text-muted-foreground py-12">Loading landscapes...</div>
  {:else if groups.length === 0}
    <div class="text-center text-muted-foreground py-12">
      No landscape data. Use
      <code class="text-xs bg-muted px-1 rounded">tracker.log_loss_landscape(grid)</code>
    </div>
  {:else}
    <!-- Toolbar: group filter + name filter + column layout -->
    <div class="flex items-center gap-2 mb-3 flex-wrap">
      <MetricPicker
        options={groupOptions}
        value={visibleRefs}
        onValueChange={onVisibleChange}
        placeholder="Landscape groups"
        formatLabel={(m) => m.key}
      />
      <input
        type="text"
        bind:value={nameFilter}
        placeholder="Filter cards..."
        class="w-32 px-2 py-1 text-xs border border-border rounded-md bg-background"
      />
      <div class="flex items-center gap-0.5 border border-border rounded-md overflow-hidden">
        <button class="px-2 py-1 text-xs {columns === 1 ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50'}" onclick={() => columns = 1}>1</button>
        <button class="px-2 py-1 text-xs {columns === 2 ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50'}" onclick={() => columns = 2}>2</button>
        <button class="px-2 py-1 text-xs {columns === 3 ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50'}" onclick={() => columns = 3}>3</button>
        <button class="px-2 py-1 text-xs {columns === 4 ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50'}" onclick={() => columns = 4}>4</button>
      </div>
    </div>

    <!-- Cards grid -->
    <div class="grid gap-3" style="grid-template-columns: repeat({columns}, minmax(0, 1fr))">
      {#each visible as g, i (g.name)}
        <div
          draggable="true"
          role="button" tabindex="0"
          ondragstart={(e) => onDragStart(e, i)}
          ondragover={(e) => onDragOver(e, i)}
          ondragend={onDragEnd}
          class="cursor-grab active:cursor-grabbing"
        >
          <LandscapeCard
            group={g}
            compact={columns >= 2}
            onMoveUp={i > 0 ? () => moveItem(i, -1) : undefined}
            onMoveDown={i < visible.length - 1 ? () => moveItem(i, 1) : undefined}
            onRemove={() => { const s = new Set(hidden); s.add(g.name); hidden = s; }}
          />
        </div>
      {/each}
    </div>
  {/if}
</div>

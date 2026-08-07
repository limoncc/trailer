<script lang="ts">
  import HistogramCard from './HistogramCard.svelte';
  import { refreshInterval } from '$lib/refresh.svelte';
  import type { HistogramPoint } from './HistogramChart.svelte';

  interface Props { runId: string; }
  let { runId }: Props = $props();

  let allData = $state<HistogramPoint[]>([]);
  let loading = $state(true);
  let showMenu = $state(false);
  let hidden = $state<Set<string>>(new Set());
  let histogramFilter = $state('');
  let columns = $state<1 | 2 | 3 | 4>(1);

  // Group by (key, context)
  let groups = $derived.by(() => {
    const map = new Map<string, { label: string; data: HistogramPoint[] }>();
    for (const h of allData) {
      const id = h.context ? `${h.key}[${h.context}]` : h.key;
      if (!map.has(id)) {
        map.set(id, { label: id, data: [] });
      }
      map.get(id)!.data.push(h);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  });

  function parseFilter(input: string): string[] {
    return input.split(/[,，]/).map(k => k.trim()).filter(Boolean);
  }

  let visible = $derived(groups.filter(([id]) => {
    if (hidden.has(id)) return false;
    const keywords = parseFilter(histogramFilter);
    if (keywords.length === 0) return true;
    return keywords.some(k => id.toLowerCase().includes(k.toLowerCase()));
  }));

  // Drag-and-drop reorder
  let dragIndex = $state(-1);
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
    // Rebuild groups order
    const reordered = arr.map(([id]) => id);
    const newGroups: typeof groups = [];
    const seen = new Set<string>();
    for (const id of reordered) {
      const g = groups.find(([gid]) => gid === id);
      if (g) { newGroups.push(g); seen.add(id); }
    }
    for (const g of groups) {
      if (!seen.has(g[0])) newGroups.push(g);
    }
    // Reflect reorder... we mutate groups indirectly
    dragIndex = idx;
  }
  function onDragEnd() { dragIndex = -1; }

  function moveItem(idx: number, dir: -1 | 1) {
    const target = idx + dir;
    if (target < 0 || target >= visible.length) return;
    const arr = [...visible];
    [arr[idx], arr[target]] = [arr[target], arr[idx]];
  }

  function metricId(m: { label: string }): string { return m.label; }

  async function loadHistograms(refresh = false) {
    if (!refresh) loading = true;
    try {
      const resp = await fetch(`/api/v1/runs/${encodeURIComponent(runId)}/histograms`);
      if (resp.ok) {
        const data = await resp.json();
        if (!refresh) {
          allData = data;
          hidden = new Set();
        } else {
          // 增量合并新 step（按 key|context|step 去重），保留已有数据避免重置
          const seen = new Set(allData.map((h) => `${h.key}|${h.context}|${h.step}`));
          const merged = [...allData];
          for (const h of data) {
            const k = `${h.key}|${h.context}|${h.step}`;
            if (!seen.has(k)) { merged.push(h); seen.add(k); }
          }
          allData = merged;
        }
      }
    } catch {}
    loading = false;
  }

  $effect(() => { if (runId) loadHistograms(); });

  // 运行中 run 实时刷新：按全局 refreshInterval 轮询增量合并新 step
  $effect(() => {
    if (!runId || $refreshInterval <= 0) return;
    const timer = setInterval(() => loadHistograms(true), $refreshInterval * 1000);
    return () => clearInterval(timer);
  });
</script>

<div class="w-full">
  {#if loading}
    <div class="text-center text-muted-foreground py-12">Loading histograms...</div>
  {:else if groups.length === 0}
    <div class="text-center text-muted-foreground py-12">No histogram data for this run</div>
  {:else}
    <!-- Toolbar: filter + column layout -->
    <div class="flex items-center gap-2 mb-3 flex-wrap">
      <!-- Filter dropdown -->
      <div class="relative" onfocusout={() => setTimeout(() => showMenu = false, 200)}>
        <button
          class="px-3 py-1 text-xs border border-border rounded-md hover:bg-accent transition-colors"
          onclick={(e) => { e.stopPropagation(); showMenu = !showMenu; }}
        >
          Histograms ▾ ({visible.length}/{groups.length})
        </button>
        {#if showMenu}
          <div class="fixed inset-0 z-10" role="presentation" onclick={() => showMenu = false} onkeydown={(e) => { if (e.key === 'Escape') showMenu = false; }}></div>
          <div class="absolute top-full left-0 mt-1 w-56 bg-card border border-border rounded-md shadow-lg z-20 py-1 max-h-72 flex flex-col">
            <div class="px-2 py-1.5 border-b border-border">
              <input
                type="text"
                placeholder="weights, bias filter..."
                bind:value={histogramFilter}
                class="w-full px-2 py-1 text-xs border border-border rounded bg-background"
                onclick={(e) => e.stopPropagation()}
              />
            </div>
            <div class="overflow-y-auto flex-1">
              {#each groups.filter(([id]) => {
                if (!histogramFilter) return true;
                const keywords = parseFilter(histogramFilter);
                if (keywords.length === 0) return true;
                return keywords.some(k => id.toLowerCase().includes(k.toLowerCase()));
              }) as [id, group]}
                <label class="flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-accent cursor-pointer">
                  <input type="checkbox" checked={!hidden.has(id)} onchange={() => {
                    const next = new Set(hidden);
                    if (next.has(id)) next.delete(id); else next.add(id);
                    hidden = next;
                  }} />
                  <span class="font-mono truncate">{id}</span>
                  <span class="ml-auto text-muted-foreground shrink-0">{group.data.length}</span>
                </label>
              {/each}
            </div>
          </div>
        {/if}
      </div>

      <!-- Column layout toggle -->
      <div class="flex items-center gap-0.5 border border-border rounded-md overflow-hidden">
        <button class="px-2 py-1 text-xs {columns === 1 ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50'}" onclick={() => columns = 1}>1</button>
        <button class="px-2 py-1 text-xs {columns === 2 ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50'}" onclick={() => columns = 2}>2</button>
        <button class="px-2 py-1 text-xs {columns === 3 ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50'}" onclick={() => columns = 3}>3</button>
        <button class="px-2 py-1 text-xs {columns === 4 ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50'}" onclick={() => columns = 4}>4</button>
      </div>
    </div>

    <!-- Cards grid -->
    <div class="grid gap-3" style="grid-template-columns: repeat({columns}, minmax(0, 1fr))">
      {#each visible as [id, group], i (id)}
        <div
          draggable="true"
          role="button" tabindex="0"
          ondragstart={(e) => onDragStart(e, i)}
          ondragover={(e) => onDragOver(e, i)}
          ondragend={onDragEnd}
          class="cursor-grab active:cursor-grabbing"
        >
          <HistogramCard
            label={id}
            data={group.data}
            compact={columns >= 2}
            onMoveUp={i > 0 ? () => moveItem(i, -1) : undefined}
            onMoveDown={i < visible.length - 1 ? () => moveItem(i, 1) : undefined}
            onRemove={() => { const s = new Set(hidden); s.add(id); hidden = s; }}
          />
        </div>
      {/each}
    </div>
  {/if}
</div>

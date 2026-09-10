<script lang="ts">
  // ─── 「添加图表 / 编辑内容」弹窗:按类型 tab 选择 widget 内容(扩展点之一) ───
  import { X, Search } from 'lucide-svelte';
  import type { MetricRef } from '$lib/utils/explore';
  import { displayMetricName } from '$lib/utils/systemMetrics';
  import { filterMetrics, groupMetricsByContext, metricId, type MetricOption } from '$lib/utils/metricGroups';
  import type { DashWidget } from '$lib/utils/dashboard';
  import { WIDGET_TYPES } from '$lib/utils/widgetTypes';
  import type { BoardsData } from './boardsData';

  interface Props {
    /** 编辑已有 widget(决定初始 tab 与选中项);新建为 null。组件按需挂载,挂载时取值 */
    editWidget?: DashWidget | null;
    metricOptions: MetricOption[];
    boardsData: BoardsData;
    onConfirm: (type: DashWidget['type'], content: Record<string, unknown>) => void;
    onClose: () => void;
  }

  let { editWidget = null, metricOptions, boardsData, onConfirm, onClose }: Props = $props();

  // 由父组件条件挂载(每次打开都是新实例),初始状态直接取自 props,无需 effect 同步
  let activeType = $state<DashWidget['type']>(editWidget?.type ?? 'line');
  let query = $state('');
  let selectedMetrics = $state<MetricRef[]>(editWidget?.type === 'line' ? [...editWidget.metrics] : []);
  let selectedHistId = $state(
    editWidget?.type === 'hist' ? (editWidget.context ? `${editWidget.key}[${editWidget.context}]` : editWidget.key) : ''
  );
  let selectedName = $state(
    editWidget && (editWidget.type === 'figure' || editWidget.type === 'text') ? editWidget.name : ''
  );
  let selectedNumericId = $state<number | null>(
    editWidget?.type === 'table' ? editWidget.tableId : editWidget?.type === 'media' ? editWidget.mediaId : null
  );

  function displayName(m: MetricRef): string {
    return displayMetricName(m.key, m.context) ?? (m.context ? `${m.key} [${m.context}]` : m.key);
  }

  const filteredMetrics = $derived(query.trim() ? filterMetrics(metricOptions, query.trim()) : metricOptions);
  const metricGroups = $derived(groupMetricsByContext(filteredMetrics, { rootLabel: 'root' }));

  // hist 分组(与 HistogramExplorer 同规则 key[context])
  const histGroups = $derived.by(() => {
    const map = new Map<string, { id: string; key: string; context: string; frames: number }>();
    for (const h of boardsData.histograms) {
      const id = h.context ? `${h.key}[${h.context}]` : h.key;
      if (!map.has(id)) map.set(id, { id, key: h.key, context: h.context, frames: 0 });
      map.get(id)!.frames++;
    }
    return [...map.values()].sort((a, b) => a.id.localeCompare(b.id));
  });

  function uniqueNames<T extends { name: string; step: number }>(rows: T[]): Array<{ name: string; latestStep: number; count: number }> {
    const map = new Map<string, { name: string; latestStep: number; count: number }>();
    for (const r of rows) {
      const hit = map.get(r.name);
      if (!hit) map.set(r.name, { name: r.name, latestStep: r.step, count: 1 });
      else {
        hit.latestStep = Math.max(hit.latestStep, r.step);
        hit.count++;
      }
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  const figureNames = $derived(uniqueNames(boardsData.figures.filter((f) => f.kind === 'png' || f.kind === 'g2')));
  const textNames = $derived(uniqueNames(boardsData.texts));

  function toggleMetric(m: MetricRef) {
    const id = metricId(m);
    if (selectedMetrics.some((s) => metricId(s) === id)) {
      selectedMetrics = selectedMetrics.filter((s) => metricId(s) !== id);
    } else {
      selectedMetrics = [...selectedMetrics, m];
    }
  }

  const canConfirm = $derived.by(() => {
    switch (activeType) {
      case 'line':
        return selectedMetrics.length > 0;
      case 'hist':
        return selectedHistId !== '';
      case 'figure':
      case 'text':
        return selectedName !== '';
      case 'table':
      case 'media':
        return selectedNumericId !== null;
    }
  });

  function confirm() {
    switch (activeType) {
      case 'line':
        onConfirm('line', { metrics: [...selectedMetrics], xKind: 'step', smooth: 0, yLog: false });
        break;
      case 'hist': {
        const g = histGroups.find((x) => x.id === selectedHistId);
        if (g) onConfirm('hist', { key: g.key, context: g.context });
        break;
      }
      case 'figure':
      case 'text':
        onConfirm(activeType, { name: selectedName });
        break;
      case 'table':
        if (selectedNumericId !== null) onConfirm('table', { tableId: selectedNumericId });
        break;
      case 'media':
        if (selectedNumericId !== null) onConfirm('media', { mediaId: selectedNumericId });
        break;
    }
  }
</script>

<div
  class="fixed inset-0 bg-black/30 z-40"
  role="presentation"
  onclick={onClose}
  onkeydown={(e) => { if (e.key === 'Escape') onClose(); }}
></div>
<div class="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 bg-card border border-border rounded-xl shadow-xl w-[560px] max-w-[92vw] max-h-[80vh] flex flex-col">
    <div class="flex items-center justify-between px-4 py-3 border-b border-border">
      <h3 class="text-sm font-semibold">{editWidget ? 'Edit Widget Content' : 'Add Chart'}</h3>
      <button onclick={onClose} class="text-muted-foreground hover:text-foreground text-sm leading-none">
        <X size={16} />
      </button>
    </div>

    <!-- 类型 tabs -->
    <div class="flex gap-1 px-4 pt-3 flex-wrap">
      {#each WIDGET_TYPES as t (t.type)}
        <button
          class="px-3 py-1.5 text-xs rounded-md transition-colors {activeType === t.type
            ? 'bg-primary text-primary-foreground'
            : 'text-muted-foreground hover:bg-accent'}"
          onclick={() => (activeType = t.type)}
        >
          {t.label}
        </button>
      {/each}
    </div>

    <div class="flex-1 overflow-auto px-4 py-3">
      {#if activeType === 'line'}
        <div class="flex items-center gap-2 mb-2">
          <div class="relative flex-1">
            <Search size={13} class="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              bind:value={query}
              placeholder="Filter metrics…"
              class="w-full pl-7 pr-2 py-1.5 text-xs border border-border rounded-md bg-background"
            />
          </div>
          <span class="text-xs text-muted-foreground shrink-0">{selectedMetrics.length} selected</span>
        </div>
        <div class="space-y-3">
          {#each metricGroups as g (g.context)}
            <div>
              <div class="text-[11px] uppercase tracking-wide text-muted-foreground mb-1 font-mono">{g.label}</div>
              <div class="space-y-0.5">
                {#each g.items as m (metricId(m))}
                  {@const checked = selectedMetrics.some((s) => metricId(s) === metricId(m))}
                  <label class="flex items-center gap-2 px-2 py-1 rounded hover:bg-accent/50 cursor-pointer text-xs font-mono">
                    <input type="checkbox" checked={checked} onchange={() => toggleMetric(m)} class="accent-primary" />
                    <span class="truncate">{displayName(m)}</span>
                  </label>
                {/each}
              </div>
            </div>
          {:else}
            <p class="text-xs text-muted-foreground text-center py-6">Run has no metrics yet</p>
          {/each}
        </div>
      {:else if activeType === 'hist'}
        {#if histGroups.length === 0}
          <p class="text-xs text-muted-foreground text-center py-6">Run has no histograms yet</p>
        {:else}
          <div class="space-y-0.5">
            {#each histGroups as g (g.id)}
              <label class="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-accent/50 cursor-pointer text-xs font-mono {selectedHistId === g.id ? 'bg-accent' : ''}">
                <input type="radio" name="hist-pick" checked={selectedHistId === g.id} onchange={() => (selectedHistId = g.id)} class="accent-primary" />
                <span class="truncate flex-1">{g.id}</span>
                <span class="text-[10px] text-muted-foreground">{g.frames} frames</span>
              </label>
            {/each}
          </div>
        {/if}
      {:else if activeType === 'figure'}
        {#if figureNames.length === 0}
          <p class="text-xs text-muted-foreground text-center py-6">Run has no figures yet</p>
        {:else}
          <div class="space-y-0.5">
            {#each figureNames as f (f.name)}
              <label class="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-accent/50 cursor-pointer text-xs font-mono {selectedName === f.name ? 'bg-accent' : ''}">
                <input type="radio" name="figure-pick" checked={selectedName === f.name} onchange={() => (selectedName = f.name)} class="accent-primary" />
                <span class="truncate flex-1">{f.name}</span>
                <span class="text-[10px] text-muted-foreground">{f.count} · step {f.latestStep}</span>
              </label>
            {/each}
          </div>
        {/if}
      {:else if activeType === 'text'}
        {#if textNames.length === 0}
          <p class="text-xs text-muted-foreground text-center py-6">Run has no text entries yet</p>
        {:else}
          <div class="space-y-0.5">
            {#each textNames as t (t.name)}
              <label class="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-accent/50 cursor-pointer text-xs font-mono {selectedName === t.name ? 'bg-accent' : ''}">
                <input type="radio" name="text-pick" checked={selectedName === t.name} onchange={() => (selectedName = t.name)} class="accent-primary" />
                <span class="truncate flex-1">{t.name}</span>
                <span class="text-[10px] text-muted-foreground">{t.count} · step {t.latestStep}</span>
              </label>
            {/each}
          </div>
        {/if}
      {:else if activeType === 'table'}
        {#if boardsData.tables.length === 0}
          <p class="text-xs text-muted-foreground text-center py-6">Run has no tables yet</p>
        {:else}
          <div class="space-y-0.5">
            {#each boardsData.tables as t (t.id)}
              <label class="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-accent/50 cursor-pointer text-xs font-mono {selectedNumericId === t.id ? 'bg-accent' : ''}">
                <input type="radio" name="table-pick" checked={selectedNumericId === t.id} onchange={() => (selectedNumericId = t.id)} class="accent-primary" />
                <span class="truncate flex-1">{t.name}</span>
                <span class="text-[10px] text-muted-foreground">#{t.id} · step {t.step} · {t.row_count} rows</span>
              </label>
            {/each}
          </div>
        {/if}
      {:else if activeType === 'media'}
        {#if boardsData.media.length === 0}
          <p class="text-xs text-muted-foreground text-center py-6">Run has no media yet</p>
        {:else}
          <div class="space-y-0.5">
            {#each boardsData.media as m (m.id)}
              <label class="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-accent/50 cursor-pointer text-xs font-mono {selectedNumericId === m.id ? 'bg-accent' : ''}">
                <input type="radio" name="media-pick" checked={selectedNumericId === m.id} onchange={() => (selectedNumericId = m.id)} class="accent-primary" />
                <span class="truncate flex-1">{m.name}</span>
                <span class="text-[10px] text-muted-foreground">#{m.id} · {m.kind} · step {m.step}</span>
              </label>
            {/each}
          </div>
        {/if}
      {/if}
    </div>

    <div class="flex items-center justify-end gap-2 px-4 py-3 border-t border-border">
      <button class="px-3 py-1.5 text-xs border border-border rounded-md hover:bg-accent" onclick={onClose}>
        Cancel
      </button>
      <button
        class="px-3 py-1.5 text-xs rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 disabled:pointer-events-none"
        disabled={!canConfirm}
        onclick={confirm}
      >
        {editWidget ? 'Save' : 'Add'}
      </button>
    </div>
  </div>


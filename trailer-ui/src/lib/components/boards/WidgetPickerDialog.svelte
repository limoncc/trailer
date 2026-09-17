<script lang="ts">
  // ─── 「添加图表 / 编辑内容」弹窗:按类型 tab 选择 widget 内容(扩展点之一) ───
  import { X, Search } from 'lucide-svelte';
  import type { MetricRef } from '$lib/utils/explore';
  import { displayMetricName } from '$lib/utils/systemMetrics';
  import { filterMetrics, groupMetricsByContext, metricId, type MetricOption } from '$lib/utils/metricGroups';
  import type { DashWidget, InfoItem, RunInfo } from '$lib/utils/dashboard';
  import { flattenConfigKeys } from '$lib/utils/infoCard';
  import { WIDGET_TYPES } from '$lib/utils/widgetTypes';
  import type { BoardsData } from './boardsData';

  interface Props {
    /** 编辑已有 widget(决定初始 tab 与选中项);新建为 null。组件按需挂载,挂载时取值 */
    editWidget?: DashWidget | null;
    metricOptions: MetricOption[];
    boardsData: BoardsData;
    /** 信息卡所需的 run 元信息(config keys / env 卡数) */
    runInfo?: RunInfo;
    onConfirm: (type: DashWidget['type'], content: Record<string, unknown>) => void;
    onClose: () => void;
  }

  let { editWidget = null, metricOptions, boardsData, runInfo, onConfirm, onClose }: Props = $props();

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

  // ─── info 卡选中态(编辑时按 items 预勾选) ───
  const initInfo = editWidget?.type === 'info' ? editWidget : null;
  let selectedFixed = $state<string[]>(
    initInfo ? initInfo.items.filter((i) => i.src === 'step' || i.src === 'elapsed' || i.src === 'cost').map((i) => i.src) : []
  );
  let selectedConfigPaths = $state<string[]>(
    initInfo ? initInfo.items.filter((i) => i.src === 'config').map((i) => i.path) : []
  );
  let selectedInfoMetrics = $state<MetricRef[]>(
    initInfo ? initInfo.items.filter((i) => i.src === 'metric').map((i) => ({ key: i.key, context: i.context })) : []
  );
  let infoGpus = $state<number | null>(initInfo?.gpus ?? null);
  let infoUnitPrice = $state<number | null>(initInfo?.unitPrice ?? null);

  const configKeys = $derived(flattenConfigKeys(runInfo?.config));
  const filteredConfigKeys = $derived(
    query.trim() ? configKeys.filter((k) => k.toLowerCase().includes(query.trim().toLowerCase())) : configKeys
  );
  const infoMetrics = $derived(
    query.trim() ? filterMetrics(metricOptions, query.trim()) : metricOptions
  );

  function toggleIn(list: string[], v: string): string[] {
    return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
  }
  function toggleInfoMetric(m: MetricRef) {
    const id = metricId(m);
    if (selectedInfoMetrics.some((s) => metricId(s) === id)) {
      selectedInfoMetrics = selectedInfoMetrics.filter((s) => metricId(s) !== id);
    } else {
      selectedInfoMetrics = [...selectedInfoMetrics, m];
    }
  }

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
      case 'info':
        return selectedFixed.length + selectedConfigPaths.length + selectedInfoMetrics.length > 0;
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
      case 'info': {
        const items: InfoItem[] = [];
        for (const src of selectedFixed) {
          if (src === 'step') items.push({ src: 'step' });
          else if (src === 'elapsed') items.push({ src: 'elapsed' });
          else items.push({ src: 'cost' });
        }
        for (const path of selectedConfigPaths) items.push({ src: 'config', path });
        for (const m of selectedInfoMetrics) items.push({ src: 'metric', key: m.key, context: m.context });
        const content: Record<string, unknown> = { items };
        if (infoGpus !== null && Number.isFinite(infoGpus) && infoGpus > 0) content.gpus = Math.round(infoGpus);
        if (infoUnitPrice !== null && Number.isFinite(infoUnitPrice) && infoUnitPrice >= 0) {
          content.unitPrice = infoUnitPrice;
        }
        onConfirm('info', content);
        break;
      }
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
      {#if activeType === 'info'}
        <!-- 固定项 -->
        <div class="space-y-0.5 mb-4">
          <label class="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-accent/50 cursor-pointer text-xs">
            <input type="checkbox" checked={selectedFixed.includes('step')} onchange={() => (selectedFixed = toggleIn(selectedFixed, 'step'))} class="accent-primary" />
            <span>当前步数</span>
          </label>
          <label class="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-accent/50 cursor-pointer text-xs">
            <input type="checkbox" checked={selectedFixed.includes('elapsed')} onchange={() => (selectedFixed = toggleIn(selectedFixed, 'elapsed'))} class="accent-primary" />
            <span>训练时长（运行中每秒跳动）</span>
          </label>
          <div class="px-2 py-1.5 rounded hover:bg-accent/50">
            <label class="flex items-center gap-2 cursor-pointer text-xs">
              <input type="checkbox" checked={selectedFixed.includes('cost')} onchange={() => (selectedFixed = toggleIn(selectedFixed, 'cost'))} class="accent-primary" />
              <span>训练成本（时长 × 卡数）</span>
            </label>
            {#if selectedFixed.includes('cost')}
              <div class="flex items-center gap-3 mt-1.5 pl-6 text-xs text-muted-foreground">
                <label class="flex items-center gap-1">
                  卡数
                  <input
                    type="number"
                    min="0"
                    step="1"
                    bind:value={infoGpus}
                    placeholder={runInfo?.gpuCount ? `auto: ${runInfo.gpuCount}` : 'auto'}
                    class="w-20 px-1.5 py-0.5 border border-border rounded bg-background"
                  />
                </label>
                <label class="flex items-center gap-1">
                  单价（元/卡时）
                  <input
                    type="number"
                    min="0"
                    step="0.1"
                    bind:value={infoUnitPrice}
                    placeholder="不折算金额"
                    class="w-24 px-1.5 py-0.5 border border-border rounded bg-background"
                  />
                </label>
              </div>
            {/if}
          </div>
        </div>

        <!-- 超参数 -->
        <div class="text-[11px] uppercase tracking-wide text-muted-foreground mb-1 font-mono">Hyperparameters (config)</div>
        {#if filteredConfigKeys.length === 0}
          <p class="text-xs text-muted-foreground text-center py-3">Run has no config entries</p>
        {:else}
          <div class="space-y-0.5 mb-4 max-h-48 overflow-auto">
            {#each filteredConfigKeys as key (key)}
              <label class="flex items-center gap-2 px-2 py-1 rounded hover:bg-accent/50 cursor-pointer text-xs font-mono">
                <input type="checkbox" checked={selectedConfigPaths.includes(key)} onchange={() => (selectedConfigPaths = toggleIn(selectedConfigPaths, key))} class="accent-primary" />
                <span class="truncate">{key}</span>
              </label>
            {/each}
          </div>
        {/if}

        <!-- 当前指标 -->
        <div class="text-[11px] uppercase tracking-wide text-muted-foreground mb-1 font-mono">Latest metrics</div>
        {#if infoMetrics.length === 0}
          <p class="text-xs text-muted-foreground text-center py-3">Run has no metrics yet</p>
        {:else}
          <div class="space-y-0.5 max-h-48 overflow-auto">
            {#each infoMetrics as m (metricId(m))}
              {@const checked = selectedInfoMetrics.some((s) => metricId(s) === metricId(m))}
              <label class="flex items-center gap-2 px-2 py-1 rounded hover:bg-accent/50 cursor-pointer text-xs font-mono">
                <input type="checkbox" checked={checked} onchange={() => toggleInfoMetric(m)} class="accent-primary" />
                <span class="truncate">{displayName(m)}</span>
              </label>
            {/each}
          </div>
        {/if}
      {:else if activeType === 'line'}
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


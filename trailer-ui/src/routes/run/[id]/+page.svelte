<script lang="ts">
  import { page } from '$app/state';
  import MetricCard from '$lib/charts/MetricCard.svelte';
  import TextExplorer from '$lib/charts/TextExplorer.svelte';
  import { refreshInterval } from '$lib/refresh.svelte';
  import { authReady } from '$lib/utils/auth';
  import FigureExplorer from '$lib/charts/FigureExplorer.svelte';
  import MediaExplorer from '$lib/charts/MediaExplorer.svelte';
  import TableExplorer from '$lib/charts/TableExplorer.svelte';
  import HistogramExplorer from '$lib/charts/HistogramExplorer.svelte';
  import ModelExplorer from '$lib/charts/ModelExplorer.svelte';
  import PCAExplorer from '$lib/charts/PCAExplorer.svelte';
  import Card from '$lib/components/ui/Card.svelte';
  import MetricPicker from '$lib/components/MetricPicker.svelte';
  import type { MetricRef } from '$lib/utils/explore';

  interface MetricGroup {
    key: string;
    context: string;
    points: Array<{ step: number; value: number; idx: number; wall_time?: number }>;
  }

  let tab = $state<'config' | 'metrics' | 'histograms' | 'pca' | 'figures' | 'texts' | 'media' | 'tables' | 'model'>('metrics');
  let runId = $state('');
  let runState = $state('');
  let runConfig = $state<Record<string, unknown> | null>(null);
  let metrics = $state<MetricGroup[]>([]);
  let loading = $state(true);
  let hidden = $state<Set<string>>(new Set());
  let resuming = $state(false);
  let shareModal = $state(false);
  let shareUrl = $state('');
  let shareExpiry = $state('7');
  let metricFilter = $state('');
  let columns = $state<1 | 2 | 3 | 4>(1);
  // Persist smooth settings across refreshes (keyed by metric ID)
  let smoothSettings = $state<Map<string, number>>(new Map());

  // 各 tab 是否有数据（决定是否显示对应标签）
  let tabDataLoaded = $state(false);
  let tabData = $state({
    config: false,
    metrics: false,
    histograms: false,
    pca: false,
    figures: false,
    texts: false,
    media: false,
    tables: false,
    model: false,
  });

  const tabs = $derived([
    { k: 'config', l: 'Config', has: tabData.config },
    { k: 'metrics', l: 'Metrics', has: tabData.metrics },
    { k: 'histograms', l: 'Histograms', has: tabData.histograms },
    { k: 'pca', l: 'PCA', has: tabData.pca },
    { k: 'figures', l: 'Figures', has: tabData.figures },
    { k: 'texts', l: 'Texts', has: tabData.texts },
    { k: 'media', l: 'Media', has: tabData.media },
    { k: 'tables', l: 'Tables', has: tabData.tables },
    { k: 'model', l: 'Model', has: tabData.model },
  ]);

  /// 并行探测各数据类型是否存在(仅首次加载),决定 tab 显隐。
  async function loadTabAvailability(id: string) {
    await authReady();
    try {
      const [hist, figs, texts, media, tables] = await Promise.all([
        fetch(`/api/v1/runs/${encodeURIComponent(id)}/histograms`).then(r => (r.ok ? r.json() : [])),
        fetch(`/api/v1/runs/${encodeURIComponent(id)}/figures`).then(r => (r.ok ? r.json() : [])),
        fetch(`/api/v1/runs/${encodeURIComponent(id)}/texts`).then(r => (r.ok ? r.json() : [])),
        fetch(`/api/v1/runs/${encodeURIComponent(id)}/media`).then(r => (r.ok ? r.json() : [])),
        fetch(`/api/v1/runs/${encodeURIComponent(id)}/tables`).then(r => (r.ok ? r.json() : [])),
      ]);
      tabData.histograms = Array.isArray(hist) && hist.length > 0;
      tabData.figures = Array.isArray(figs) && figs.some((f: any) => f.kind !== 'model' && f.kind !== 'pca');
      tabData.pca = Array.isArray(figs) && figs.some((f: any) => f.kind === 'pca');
      tabData.model = Array.isArray(figs) && figs.some((f: any) => f.kind === 'model');
      tabData.texts = Array.isArray(texts) && texts.length > 0;
      tabData.media = Array.isArray(media) && media.length > 0;
      tabData.tables = Array.isArray(tables) && tables.length > 0;
    } catch { /* 探测失败时对应 tab 保持隐藏 */ }
    tabDataLoaded = true;
  }

  /// 探测完成后:当前 tab 无数据时自动切到第一个有数据的 tab。
  $effect(() => {
    if (!tabDataLoaded) return;
    const visible = tabs.filter(t => t.has);
    if (visible.length > 0 && !visible.some(t => t.k === tab)) {
      tab = visible[0].k as any;
    }
  });

  async function createShare() {
    const days = shareExpiry === '0' ? null : parseInt(shareExpiry);
    const resp = await fetch('/api/v1/share', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ resource_type: 'run', resource_id: runId, expires_in_days: days }),
    });
    if (!resp.ok) return;
    const data = await resp.json();
    shareUrl = `${location.origin}/run/${runId}?token=${data.token}`;
    shareModal = true;
  }

  let copyBtnText = $state('Copy');

  async function copyShare() {
    try { await navigator.clipboard.writeText(shareUrl); } catch {}
    copyBtnText = 'Copied!';
    setTimeout(() => copyBtnText = 'Copy', 1500);
  }

  async function handleResume() {
    resuming = true;
    try {
      const resp = await fetch(`/api/v1/runs/${encodeURIComponent(runId)}/resume`, { method: 'POST' });
      if (resp.ok) runState = 'running';
    } catch {}
    resuming = false;
  }

  function metricId(m: MetricGroup): string {
    return m.context ? `${m.key}[${m.context}]` : m.key;
  }

  /// Parse comma-separated keywords (support Chinese commas)
  function parseFilter(input: string): string[] {
    return input.split(/[,，]/).map(k => k.trim()).filter(Boolean);
  }

  let visibleMetrics = $derived(metrics.filter(m => {
    if (hidden.has(metricId(m))) return false;
    const keywords = parseFilter(metricFilter);
    if (keywords.length === 0) return true;
    const id = metricId(m).toLowerCase();
    return keywords.some(k => id.includes(k.toLowerCase()));
  }));

  // MetricPicker 适配: hidden(黑名单) <-> visibleRefs(白名单)
  const metricOptions = $derived(metrics.map(m => ({ key: m.key, context: m.context, count: m.points.length })));
  const visibleRefs = $derived(
    metrics.filter(m => !hidden.has(metricId(m))).map(m => ({ key: m.key, context: m.context })),
  );
  function onMetricsChange(next: MetricRef[]) {
    const ids = new Set(next.map(m => (m.context ? `${m.key}[${m.context}]` : m.key)));
    hidden = new Set(metrics.map(metricId).filter(id => !ids.has(id)));
  }

  // Track the maximum step seen so the next poll only fetches newer points.
  let maxStep = $state(0);

  async function loadMetrics(id: string, opts?: { refresh?: boolean }) {
    await authReady();
    const refreshing = opts?.refresh ?? false;
    if (!refreshing) loading = true;

    try {
      // Build URL: after first load, use after_step to get only new points
      let url = `/api/v1/metrics?run_id=${encodeURIComponent(id)}&max_points=1000`;
      if (refreshing && maxStep > 0) url += `&after_step=${maxStep}`;

      const [metricsResp, runsResp] = await Promise.all([
        fetch(url),
        fetch(`/api/v1/runs`),
      ]);

      if (metricsResp.ok) {
        const data: MetricGroup[] = await metricsResp.json();

        if (!refreshing) {
          // First load: fresh data
          metrics = data;
          tabData.metrics = data.length > 0;
          hidden = new Set();
        } else {
          // Refresh: append new points to existing metric groups
          const metricMap = new Map(metrics.map(m => [metricId(m), m]));
          for (const incoming of data) {
            const key = metricId(incoming);
            const existing = metricMap.get(key);
            if (existing) {
              // Merge points — avoid duplicates by step
              const seenSteps = new Set(existing.points.map(p => p.step));
              for (const p of incoming.points) {
                if (!seenSteps.has(p.step)) {
                  existing.points = [...existing.points, p];
                  seenSteps.add(p.step);
                }
              }
            } else {
              // New metric appeared (e.g. user started logging a new key)
              metrics = [...metrics, incoming];
            }
          }
        }

        // Update maxStep from all metric points
        for (const m of metrics) {
          for (const p of m.points) {
            if (p.step > maxStep) maxStep = p.step;
          }
        }
      }

      if (runsResp.ok) {
        const runs = await runsResp.json();
        const r = runs.find((x: any) => x.run_id === id);
        if (r) { runState = r.state; runConfig = r.config || null; }
      }
      tabData.config = !!runConfig && Object.keys(runConfig).length > 0;
    } catch (_) {}
    loading = false;
  }

  // Drag-and-drop reorder
  let dragIndex = $state(-1);

  function onDragStart(e: DragEvent, idx: number) {
    dragIndex = idx;
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
  }

  function onDragOver(e: DragEvent, idx: number) {
    e.preventDefault();
    if (dragIndex < 0 || dragIndex === idx) return;
    const arr = [...visibleMetrics];
    const [moved] = arr.splice(dragIndex, 1);
    arr.splice(idx, 0, moved);
    const reordered = arr.map(m => metricId(m));
    const newMetrics: MetricGroup[] = [];
    const seen = new Set<string>();
    for (const id of reordered) {
      const m = metrics.find(x => metricId(x) === id);
      if (m) { newMetrics.push(m); seen.add(id); }
    }
    for (const m of metrics) {
      if (!seen.has(metricId(m))) newMetrics.push(m);
    }
    metrics = newMetrics;
    dragIndex = idx;
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
  }

  function onDragEnd() { dragIndex = -1; }

  function moveMetric(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= visibleMetrics.length) return;
    const arr = [...visibleMetrics];
    [arr[index], arr[target]] = [arr[target], arr[index]];
    // Reorder: rebuild the full `metrics` array based on new visible order
    const newOrder: MetricGroup[] = [];
    const visibleSet = new Set(arr.map(metricId));
    // Place visible in new order, then remaining hidden at the end
    for (const v of arr) {
      if (!newOrder.find(m => metricId(m) === metricId(v))) newOrder.push(v);
    }
    for (const m of metrics) {
      if (!visibleSet.has(metricId(m)) && !newOrder.find(x => metricId(x) === metricId(m))) {
        newOrder.push(m);
      }
    }
    metrics = newOrder;
  }

  $effect(() => {
    const id = page.params.id;
    if (id && id !== runId) { runId = id; maxStep = 0; loadMetrics(id); loadTabAvailability(id); }
  });

  // Auto-refresh: incremental update (only fetches points after maxStep)
  $effect(() => {
    const id = page.params.id;
    if (!id || $refreshInterval <= 0) return;
    const timer = setInterval(() => { if (id) loadMetrics(id, { refresh: true }); }, $refreshInterval * 1000);
    return () => clearInterval(timer);
  });
</script>

<svelte:head><title>Run — Trailer</title></svelte:head>

<div class="p-6 flex flex-col h-full min-h-0">
  <div class="flex items-center gap-3 mb-4 shrink-0">
    <a href="/" class="text-sm text-muted-foreground hover:text-foreground">← Back</a>
    <h1 class="text-xl font-bold font-mono">{runId || 'Loading...'}</h1>
    <button type="button" onclick={createShare} class="px-3 py-1 text-xs border border-border rounded-md hover:bg-accent">Share
    </button>
    {#if runState && runState !== 'running'}
      <button
        onclick={handleResume}
        disabled={resuming}
        class="px-3 py-1 text-xs bg-primary text-primary-foreground rounded-md disabled:opacity-50"
      >
        {resuming ? 'Resuming...' : 'Resume'}
      </button>
    {/if}
  </div>

  {#if shareModal}
    <div class="fixed inset-0 bg-black/30 z-40" role="presentation" onclick={() => shareModal = false} onkeydown={(e) => { if (e.key === 'Escape') shareModal = false; }}></div>
    <div class="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 bg-card border border-border rounded-xl shadow-xl p-6 w-96">
      <div class="flex items-center justify-between mb-3">
        <h3 class="text-sm font-semibold">Share Run</h3>
        <button type="button" onclick={() => shareModal = false} class="text-muted-foreground hover:text-foreground text-sm leading-none">✕</button>
      </div>
      <p class="text-xs text-muted-foreground mb-3">Anyone with this link can view this run:</p>
      <div class="flex items-center gap-2 mb-3 text-xs">
        <span class="text-muted-foreground shrink-0">Expires in:</span>
        <select bind:value={shareExpiry} class="px-2 py-1 border border-border rounded-md bg-background">
          <option value="7">7 days</option>
          <option value="30">30 days</option>
          <option value="90">90 days</option>
          <option value="0">Never</option>
        </select>
      </div>
      <div class="flex items-center gap-2 mb-4">
        <input readonly value={shareUrl} class="flex-1 px-2 py-1.5 text-xs font-mono bg-muted border border-border rounded-md" />
        <button type="button" onclick={copyShare} class="px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded-md shrink-0">{copyBtnText}</button>
      </div>
    </div>
  {/if}

  {#if runId}
    <div class="flex gap-1 mb-4 border-b border-border shrink-0">
      {#each tabs.filter(t => t.has) as t}
        <button class="px-4 py-2 text-sm font-medium border-b-2 {tab === t.k ? 'border-ring' : 'border-transparent text-muted-foreground'}" onclick={() => tab = t.k as any}>{t.l}</button>
      {/each}
    </div>

    <div class="flex-1 min-h-0">
    {#if tab === 'metrics'}
      {#if loading}
        <div class="text-center text-muted-foreground py-12">Loading...</div>
      {:else if metrics.length > 0}
        <div class="flex items-center gap-2 mb-3 flex-wrap">
          <MetricPicker
            options={metricOptions}
            value={visibleRefs}
            onValueChange={onMetricsChange}
            formatLabel={(m) => (m.context ? `${m.key} [${m.context}]` : m.key)}
          />
          <input
            type="text"
            bind:value={metricFilter}
            placeholder="Filter cards..."
            class="w-32 px-2 py-1 text-xs border border-border rounded-md bg-background"
          />

          <!-- Column layout toggle -->
          <div class="flex items-center gap-0.5 border border-border rounded-md overflow-hidden">
            <button class="px-2 py-1 text-xs {columns === 1 ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50'}" onclick={() => columns = 1}>1</button>
            <button class="px-2 py-1 text-xs {columns === 2 ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50'}" onclick={() => columns = 2}>2</button>
            <button class="px-2 py-1 text-xs {columns === 3 ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50'}" onclick={() => columns = 3}>3</button>
            <button class="px-2 py-1 text-xs {columns === 4 ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50'}" onclick={() => columns = 4}>4</button>
          </div>
        </div>

        <div class="grid gap-3" style="grid-template-columns: repeat({columns}, minmax(0, 1fr))">
          {#each visibleMetrics as m, i (metricId(m))}
            <div
              draggable="true"
              role="button" tabindex="0"
              ondragstart={(e) => onDragStart(e, i)}
              ondragover={(e) => onDragOver(e, i)}
              ondragend={onDragEnd}
              class="cursor-grab active:cursor-grabbing"
            >
              <MetricCard
                key={m.key}
                context={m.context}
                data={m.points}
                running={runState === 'running'}
                onMoveUp={i > 0 ? () => moveMetric(i, -1) : undefined}
                onMoveDown={i < visibleMetrics.length - 1 ? () => moveMetric(i, 1) : undefined}
                onRemove={() => { const s = new Set(hidden); s.add(metricId(m)); hidden = s; }}
              />
            </div>
          {/each}
        </div>
      {:else if !loading}
        <div class="text-center text-muted-foreground py-12">No metrics data</div>
      {/if}
    {:else if tab === 'model'}
      {#key tab}
        <ModelExplorer {runId} />
      {/key}
    {:else if tab === 'config'}
      <Card>
        <div class="p-4">
          {#if runConfig && Object.keys(runConfig).length > 0}
            <div class="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
              {#each Object.entries(runConfig) as [key, value]}
                <span class="font-mono text-muted-foreground">{key}</span>
                <span class="font-mono font-medium text-foreground">{typeof value === 'object' ? JSON.stringify(value) : String(value)}</span>
              {/each}
            </div>
          {:else}
            <p class="text-center text-muted-foreground py-8 text-sm">No config recorded for this run.</p>
          {/if}
        </div>
      </Card>
    {:else if tab === 'histograms'}
      {#key tab}
        <HistogramExplorer {runId} />
      {/key}
    {:else if tab === 'pca'}
      {#key tab}
        <PCAExplorer {runId} />
      {/key}
    {:else if tab === 'figures'}
      <FigureExplorer {runId} />
    {:else if tab === 'media'}
      <MediaExplorer {runId} />
    {:else if tab === 'tables'}
      <TableExplorer {runId} />
    {:else}
      <TextExplorer {runId} />
    {/if}
  </div>
  {/if}
</div>

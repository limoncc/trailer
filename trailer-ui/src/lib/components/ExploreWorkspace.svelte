<script lang="ts">
  import { onMount } from 'svelte';
  import RunPicker from '$lib/components/RunPicker.svelte';
  import ExploreChartCard from '$lib/components/ExploreChartCard.svelte';
  import { api } from '$lib/utils/api';
  import type { ChartDef, RunRecord, SeriesData, MetricRef } from '$lib/utils/explore';
  import { loadSeries, parseSummaryKey } from '$lib/utils/explore';

  interface Props {
    initialRunIds?: string[];
    initialDefs?: ChartDef[];
    initialTitle?: string;
    savedId?: string | null;
    readOnly?: boolean;
    onSaved?: (id: string) => void;
    onShare?: () => void;
  }
  let {
    initialRunIds = [],
    initialDefs = [],
    initialTitle = 'Untitled analysis',
    savedId = null,
    readOnly = false,
    onSaved,
    onShare,
  }: Props = $props();

  let runs: RunRecord[] = $state([]);
  // svelte-ignore state_referenced_locally
  let selectedRuns = $state<Set<string>>(new Set(initialRunIds));
  let series: SeriesData = $state(new Map());
  // svelte-ignore state_referenced_locally
  let chartDefs: ChartDef[] = $state(initialDefs);
  let columns = $state<1 | 2 | 3>(1);
  let loading = $state(true);
  // svelte-ignore state_referenced_locally
  let title = $state(initialTitle);
  let saving = $state(false);
  let saveMsg = $state<{ text: string; ok: boolean } | null>(null);
  let msgTimer: ReturnType<typeof setTimeout> | undefined;

  const selectedRecords = $derived(runs.filter((r) => selectedRuns.has(r.run_id)));

  function collectNeededMetrics(defs: ChartDef[]): MetricRef[] {
    const out: MetricRef[] = [];
    for (const d of defs) {
      if (d.type === 'line') out.push(...d.metrics);
      else if (d.type === 'scatter-pair') {
        out.push(d.x.metric);
        out.push(d.y.metric);
      }
    }
    return out;
  }

  /** 默认图表指标:选中 run 的第一个 summary 指标(保证有数据,而非硬编码 loss/'') */
  function pickDefaultMetric(): MetricRef {
    const rec = selectedRecords[0];
    const k = rec?.summary ? Object.keys(rec.summary)[0] : null;
    return k ? parseSummaryKey(k) : { key: 'loss', context: '' };
  }

  function hasMetric(m: MetricRef): boolean {
    return selectedRecords.some((r) =>
      Object.keys(r.summary || {}).some((k) => {
        const { key, context } = parseSummaryKey(k);
        return key === m.key && context === m.context;
      })
    );
  }

  async function refreshSeries() {
    // 默认(context='')且选中 run 无该指标的 line 图,自动替换为实际存在的指标
    if (selectedRecords.length > 0) {
      const fallback = pickDefaultMetric();
      chartDefs = chartDefs.map((d) => {
        if (d.type !== 'line') return d;
        return { ...d, metrics: d.metrics.map((m) => (m.context === '' && !hasMetric(m) ? fallback : m)) };
      });
    }
    await loadSeries(series, selectedRecords, collectNeededMetrics(chartDefs), 500);
    series = new Map(series);
  }

  async function load() {
    loading = true;
    const resp = await api('/api/v1/runs?limit=1000');
    if (resp.ok) {
      runs = await resp.json();
    }
    if (chartDefs.length === 0) {
      chartDefs = [{ type: 'line', x: { kind: 'step' }, metrics: [{ key: 'loss', context: '' }], color: { kind: 'run' } }];
    }
    await refreshSeries();
    loading = false;
  }

  onMount(load);

  function toggleSelect(runId: string, checked: boolean) {
    const next = new Set(selectedRuns);
    if (checked) next.add(runId);
    else next.delete(runId);
    selectedRuns = next;
    refreshSeries();
  }

  function clearSelection() {
    selectedRuns = new Set();
    refreshSeries();
  }

  function addChart() {
    chartDefs = [
      ...chartDefs,
      { type: 'line', x: { kind: 'step' }, metrics: [pickDefaultMetric()], color: { kind: 'run' } },
    ];
    refreshSeries();
  }

  function updateDef(i: number, def: ChartDef) {
    chartDefs = chartDefs.map((d, idx) => (idx === i ? def : d));
    refreshSeries();
  }

  function removeDef(i: number) {
    chartDefs = chartDefs.filter((_, idx) => idx !== i);
    refreshSeries();
  }

  function copyDef(i: number) {
    chartDefs = [...chartDefs.slice(0, i + 1), { ...chartDefs[i] }, ...chartDefs.slice(i + 1)];
  }

  async function save() {
    saving = true;
    saveMsg = null;
    clearTimeout(msgTimer);
    const body = {
      title,
      description: '',
      run_ids: JSON.stringify([...selectedRuns]),
      chart_defs: JSON.stringify(chartDefs),
      config: JSON.stringify({ columns }),
    };
    const url = savedId ? `/api/v1/explores/${savedId}` : '/api/v1/explores';
    try {
      const resp = await api(url, {
        method: savedId ? 'PUT' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (resp.ok) {
        const data = await resp.json();
        onSaved?.(data.id as string);
        saveMsg = { text: savedId ? '✓ Saved' : '✓ Created', ok: true };
      } else {
        saveMsg = { text: `Save failed (HTTP ${resp.status})`, ok: false };
      }
    } catch (e) {
      saveMsg = { text: `Save failed: ${e instanceof Error ? e.message : String(e)}`, ok: false };
    } finally {
      saving = false;
      msgTimer = setTimeout(() => (saveMsg = null), 3000);
    }
  }
</script>

<div class="flex flex-col h-full">
  <!-- 工具栏 -->
  <div class="flex items-center gap-2 px-3 py-2 border-b border-border">
    {#if readOnly}
      <span class="text-sm font-semibold">{title}</span>
      <span class="text-xs text-muted-foreground ml-1">{selectedRuns.size} runs · {chartDefs.length} charts</span>
    {:else}
      <input
        bind:value={title}
        class="text-sm font-medium w-56 px-2 py-1 border border-border rounded-md bg-background"
        placeholder="Analysis title"
      />
      <RunPicker {runs} selected={selectedRuns} onselect={toggleSelect} onclear={clearSelection} />
      <span class="text-xs text-muted-foreground hidden sm:inline shrink-0">
        {selectedRuns.size} runs selected
      </span>
    {/if}
    <div class="ml-auto flex items-center gap-1.5 shrink-0">
      {#if onShare && savedId && !readOnly}
        <button
          type="button"
          onclick={onShare}
          class="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs border border-border rounded-md hover:bg-accent/50 transition-colors"
        >
          <svg class="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.59 13.51 6.83 3.98"/><path d="m15.41 6.51-6.82 3.98"/></svg>
          Share
        </button>
      {/if}
      {#if !readOnly}
        <div class="flex items-center gap-0.5 border border-border rounded-md overflow-hidden">
          {#each [1, 2, 3] as n (n)}
            <button
              type="button"
              class="px-2 py-1.5 text-xs {columns === n ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50'}"
              onclick={() => (columns = n as 1 | 2 | 3)}
            >
              {n}
            </button>
          {/each}
        </div>
        <button
          type="button"
          onclick={addChart}
          class="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs border border-border rounded-md hover:bg-accent/50 transition-colors"
        >
          <svg class="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14"/><path d="M12 5v14"/></svg>
          Add Chart
        </button>
        <button
          type="button"
          onclick={save}
          disabled={saving}
          class="inline-flex items-center gap-1 px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded-md hover:opacity-90 transition-opacity disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Save'}
        </button>
        {#if saveMsg}
          <span class="text-xs {saveMsg.ok ? 'text-green-600' : 'text-destructive'}" aria-live="polite">
            {saveMsg.text}
          </span>
        {/if}
      {/if}
    </div>
  </div>

  <!-- 图表区 -->
  <div class="flex-1 p-3 overflow-y-auto">
    {#if loading}
      <p class="text-center text-muted-foreground py-10 text-sm">Loading...</p>
    {:else if chartDefs.length === 0}
      <div class="border border-dashed rounded-md p-10 text-center text-sm text-muted-foreground">
        Select runs and add charts to start exploring.      </div>
    {:else}
      <div class="grid gap-3" style="grid-template-columns: repeat({columns}, minmax(0, 1fr))">
        {#each chartDefs as def, i}
          <ExploreChartCard
            {def}
            runs={selectedRecords}
            {series}
            readOnly={readOnly}
            onChange={(d) => updateDef(i, d)}
            onRemove={() => removeDef(i)}
            onCopy={() => copyDef(i)}
          />
        {/each}
      </div>
    {/if}
  </div>
</div>

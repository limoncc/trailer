<script lang="ts">
  import { page } from '$app/state';
  import ParallelChart from '$lib/charts/ParallelChart.svelte';
  import { authReady } from '$lib/utils/auth';

  let sweepId = $state('');
  let runs = $state<any[]>([]);
  let loading = $state(true);

  $effect(() => {
    loadRuns();
  });

  async function loadRuns() {
    await authReady();
    sweepId = page.params.id;
    if (!sweepId) { loading = false; return; }
    try {
      const resp = await fetch(`/api/v1/runs?limit=200`);
      if (resp.ok) {
        const all = await resp.json();
        runs = all.filter((r: any) => r.sweep_id === sweepId);
      }
    } catch {}
    loading = false;
  }

  let chartData = $derived(
    runs.map((r) => {
      const row: Record<string, unknown> = { run_id: r.run_id.slice(0, 12) };
      // Config values (from Tracker config)
      if (r.config && typeof r.config === 'object') {
        for (const [k, v] of Object.entries(r.config)) {
          if (typeof v === 'number') row[`cfg_${k}`] = v;
        }
      }
      // Summary values (metric last/best — includes scalar hp logged as metrics)
      if (r.summary && typeof r.summary === 'object') {
        for (const [k, v] of Object.entries(r.summary)) {
          if (v && typeof v === 'object' && 'last' in (v as any)) {
            const key = k.replace(/\//g, '_');
            row[`metric_${key}`] = (v as any).last;
          }
        }
      }
      return row;
    })
  );

  let dimensions = $derived.by(() => {
    if (chartData.length === 0) return [];
    const keys = new Set<string>();
    for (const row of chartData) {
      for (const k of Object.keys(row)) {
        if (k !== 'run_id') keys.add(k);
      }
    }
    return [...keys].sort();
  });
</script>

<svelte:head><title>Sweep: {sweepId} — Trailer</title></svelte:head>

<div class="p-6">
  <a href="/" class="text-sm text-muted-foreground hover:text-foreground">← Back</a>
  <h1 class="text-xl font-bold font-mono mt-2 mb-1">{sweepId || 'Loading...'}</h1>
  <p class="text-xs text-muted-foreground mb-4">{runs.length} runs · {dimensions.length} dimensions</p>

  {#if loading}
    <p class="text-center text-muted-foreground py-8">Loading...</p>
  {:else if chartData.length > 1 && dimensions.length > 1}
    <div class="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <div class="lg:col-span-2 border border-border rounded-md p-3">
        <ParallelChart
          data={chartData}
          {dimensions}
          height={Math.max(300, dimensions.length * 60)}
          title="Parameter vs Metric"
        />
      </div>
      <div class="space-y-3">
        <!-- Top runs -->
        <div class="border border-border rounded-md p-3">
          <h3 class="text-xs font-semibold mb-2">Top Runs</h3>
          <div class="space-y-1.5 max-h-60 overflow-y-auto">
            {#each runs.slice(0, 10) as run}
              <a href="/run/{run.run_id}" class="flex items-center justify-between gap-2 text-[11px] font-mono p-1.5 rounded hover:bg-accent/50 no-underline text-foreground">
                <span class="truncate">{run.name || run.run_id.slice(0, 12)}</span>
                <span class="text-muted-foreground shrink-0">{run.state}</span>
              </a>
            {/each}
          </div>
        </div>
        <!-- Compare all -->
        <a href="/compare?run_ids={runs.map(r => r.run_id).join(',')}" class="block w-full text-center py-2 text-xs border border-border rounded-md hover:bg-accent transition-colors no-underline text-foreground">
          Compare all {runs.length} runs
        </a>
      </div>
    </div>

    <details class="mt-2 text-xs text-muted-foreground cursor-pointer">
      <summary class="hover:text-foreground">💡 How to read this chart</summary>
      <div class="mt-2 p-3 bg-muted/30 rounded-md space-y-1 leading-relaxed">
        <p>• <strong>Each line</strong> = one experiment run (colored by run ID)</p>
        <p>• <strong>Each vertical axis</strong> = one parameter (<code>cfg_</code>) or metric (<code>metric_</code>)</p>
        <p>• Lines crossing between axes show how parameter values relate to results</p>
      </div>
    </details>
  {:else if runs.length === 0}
    <p class="text-center text-muted-foreground py-8">Sweep not found</p>
  {:else}
    <p class="text-center text-muted-foreground py-8">Not enough data ({chartData.length} runs, {dimensions.length} dimensions)</p>
  {/if}
</div>

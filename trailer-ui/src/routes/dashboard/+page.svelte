<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import ActivityChart from '$lib/charts/ActivityChart.svelte';
  import { authReady } from '$lib/utils/auth';
  import PaginationBar from '$lib/components/PaginationBar.svelte';

  let runs = $state<any[]>([]);
  let loading = $state(true);
  let today = new Date().toISOString().slice(0, 10);
  let page = $state(1);
  let perPage = $state(20);

  function token() { return localStorage.getItem('trailer_token') || ''; }
  function hdrs() { return { authorization: `Bearer ${token()}` }; }

  onMount(async () => {
    await authReady();
    try {
      const resp = await fetch('/api/v1/runs?limit=5000', { headers: hdrs() }).catch(() => null);
      if (resp?.ok) runs = await resp.json();
    } catch {}
    loading = false;
  });

  // Top stats
  let projects = $derived([...new Set(runs.map((r: any) => r.project))]);
  let activeCount = $derived(runs.filter((r: any) => r.state === 'running').length);
  let crashedCount = $derived(runs.filter((r: any) => r.state === 'crashed').length);
  let todayCount = $derived(runs.filter((r: any) => {
    if (!r.created_at) return false;
    return new Date(r.created_at * 1000).toISOString().slice(0, 10) === today;
  }).length);

  // Activity heatmap
  let activity = $derived.by(() => {
    const act: Record<string, number> = {};
    for (const r of runs) {
      if (r.created_at) {
        const d = new Date(r.created_at * 1000).toISOString().slice(0, 10);
        act[d] = (act[d] || 0) + 1;
      }
    }
    return act;
  });

  // Project overview table
  let projectRows = $derived.by(() => {
    const byProject = new Map<string, any[]>();
    for (const r of runs) {
      if (!byProject.has(r.project)) byProject.set(r.project, []);
      byProject.get(r.project)!.push(r);
    }
    return [...byProject.entries()].map(([project, pruns]) => {
      const active = pruns.filter((r: any) => r.state === 'running').length;
      let bestKey = '', bestVal: number | null = null;
      for (const r of pruns) {
        for (const [k, v] of Object.entries(r.summary || {})) {
          const bv = (v as any)?.best;
          if (typeof bv === 'number') {
            // Loss: lower better; others: higher better
            const isLoss = k.toLowerCase().includes('loss');
            const better = bestVal == null || (isLoss ? bv < bestVal : bv > bestVal);
            if (better) { bestVal = bv; bestKey = k.replace(/\/$/, ''); }
          }
        }
      }
      const lastActive = Math.max(...pruns.map((r: any) => r.created_at || 0));
      return { project, runs: pruns.length, active, bestKey, bestVal, lastActive };
    }).sort((a, b) => b.lastActive - a.lastActive);
  });

  // 项目概览表按当前页 slice(统计/热力图保持全量)
  let pageRows = $derived(projectRows.slice((page - 1) * perPage, (page - 1) * perPage + perPage));

  function timeAgo(ts: number): string {
    const diff = (Date.now() / 1000) - ts;
    if (diff < 60) return 'just now';
    if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
    if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
    if (diff < 604800) return Math.floor(diff / 86400) + 'd ago';
    return new Date(ts * 1000).toLocaleDateString();
  }
</script>

<svelte:head><title>Dashboard — Trailer</title></svelte:head>

<div class="p-6 max-w-5xl">
  <a href="/" class="text-sm text-muted-foreground hover:text-foreground mb-4 inline-block">← Back</a>
  <h1 class="text-xl font-bold mb-6">Dashboard</h1>

  {#if loading}
    <p class="text-sm text-muted-foreground">Loading...</p>
  {:else}
    <!-- Top stats -->
    <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
      <div class="border border-border rounded-lg p-4">
        <p class="text-2xl font-bold tabular-nums">{projects.length}</p>
        <p class="text-xs text-muted-foreground mt-0.5">Projects</p>
      </div>
      <button onclick={() => goto('/')} class="border border-border rounded-lg p-4 text-left hover:bg-accent/30 transition-colors">
        <p class="text-2xl font-bold tabular-nums text-blue-600">{todayCount}</p>
        <p class="text-xs text-muted-foreground mt-0.5">Runs today</p>
      </button>
      <div class="border border-border rounded-lg p-4">
        <p class="text-2xl font-bold tabular-nums text-green-600">{activeCount}</p>
        <p class="text-xs text-muted-foreground mt-0.5">Running</p>
      </div>
      <div class="border border-border rounded-lg p-4">
        <p class="text-2xl font-bold tabular-nums" class:text-red-600={crashedCount > 0}>{crashedCount}</p>
        <p class="text-xs text-muted-foreground mt-0.5">Crashed</p>
      </div>
    </div>

    <!-- Project overview table -->
    <h2 class="text-sm font-semibold mb-3">Project Overview</h2>
    <div class="border border-border rounded-lg overflow-hidden mb-6">
      <table class="w-full text-sm">
        <thead class="bg-muted/30 border-b border-border text-muted-foreground text-xs">
          <tr>
            <th class="px-4 py-2.5 text-left font-medium">Project</th>
            <th class="px-4 py-2.5 text-right font-medium">Runs</th>
            <th class="px-4 py-2.5 text-right font-medium">Active</th>
            <th class="px-4 py-2.5 text-right font-medium">Best Metric</th>
            <th class="px-4 py-2.5 text-right font-medium">Last Active</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-border">
          {#each pageRows as row}
            <tr class="hover:bg-muted/30 transition-colors cursor-pointer" onclick={() => goto(`/?project=${encodeURIComponent(row.project)}`)}>
              <td class="px-4 py-2.5 font-medium">{row.project}</td>
              <td class="px-4 py-2.5 text-right font-mono tabular-nums">{row.runs}</td>
              <td class="px-4 py-2.5 text-right">
                {#if row.active > 0}
                  <span class="inline-flex items-center gap-1 text-green-600 font-mono tabular-nums">
                    <span class="w-1.5 h-1.5 rounded-full bg-green-500"></span>{row.active}
                  </span>
                {:else}
                  <span class="text-muted-foreground font-mono tabular-nums">0</span>
                {/if}
              </td>
              <td class="px-4 py-2.5 text-right font-mono text-xs">
                {#if row.bestVal != null}
                  {row.bestKey}: <span class="font-semibold">{row.bestVal.toExponential(3)}</span>
                {:else}
                  <span class="text-muted-foreground">—</span>
                {/if}
              </td>
              <td class="px-4 py-2.5 text-right text-xs text-muted-foreground">{timeAgo(row.lastActive)}</td>
            </tr>
          {/each}
          {#if projectRows.length === 0}
            <tr><td colspan="5" class="px-4 py-8 text-center text-muted-foreground text-xs">No runs yet</td></tr>
          {/if}
        </tbody>
      </table>
    </div>
    <PaginationBar bind:page bind:perPage total={projectRows.length} />

    <!-- Activity heatmap -->
    <h2 class="text-sm font-semibold mb-3">Experiment Activity</h2>
    <div class="border border-border rounded-lg p-4 mb-6">
      <ActivityChart data={activity} />
    </div>
  {/if}
</div>

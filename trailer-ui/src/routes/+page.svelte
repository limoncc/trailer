<script lang="ts">
  import { page } from '$app/state';
  import ExperimentTable from '$lib/components/ExperimentTable.svelte';
  import ActivityChart from '$lib/charts/ActivityChart.svelte';
  import { Microscope } from 'lucide-svelte';
  import { authReady } from '$lib/utils/auth';

  let project = $derived(page.url.searchParams.get('project') || '');
  let stats = $state({ runs: 0, activeRuns: 0, reports: 0 });
  let activity = $state<Record<string, number>>({});

  async function loadStats() {
    await authReady();
    const [runsResp, reportsResp] = await Promise.all([
      fetch('/api/v1/runs?limit=10000').catch(() => null),
      fetch('/api/v1/reports').catch(() => null),
    ]);

    const runs = runsResp?.ok ? await runsResp.json() : [];
    const reports = reportsResp?.ok ? await reportsResp.json() : [];
    stats = { runs: runs.length, activeRuns: runs.filter((r: any) => r.state === 'running').length, reports: reports.length };

    const act: Record<string, number> = {};
    for (const r of runs) {
      if (r.created_at) {
        const d = new Date(r.created_at * 1000).toISOString().slice(0, 10);
        act[d] = (act[d] || 0) + 1;
      }
    }
    activity = act;
  }

  // Re-fetch stats every time the page is navigated to
  $effect(() => { page.url; loadStats(); });
</script>

{#if project}
  <div class="flex items-center justify-between px-6 pt-4">
    <h2 class="text-lg font-bold">Project: {project}</h2>
  </div>
  <ExperimentTable {project} />
{:else}
  <div class="flex justify-center pt-12">
    <div class="text-center">
      <Microscope class="size-16 mb-6 mx-auto text-foreground" />
      <p class="text-2xl font-bold mb-3 text-foreground">Welcome to Trailer</p>
      <p class="text-sm text-muted-foreground mb-6">Select a project from the sidebar, or start tracking:</p>
      <pre class="text-sm bg-muted/50 p-4 rounded-xl text-left border border-border shadow-sm inline-block"><code
        ><span class="text-blue-500 dark:text-blue-400">from</span> trailer <span class="text-blue-500 dark:text-blue-400">import</span> Tracker
tracker <span class="text-purple-500">=</span> Tracker(project<span class="text-purple-500">=</span><span class="text-green-600 dark:text-green-400">"my_project"</span>)
tracker.<span class="text-yellow-600 dark:text-yellow-400">log</span>(&#123;<span class="text-green-600 dark:text-green-400">"train/loss"</span>: <span class="text-orange-500">0.5</span>, <span class="text-green-600 dark:text-green-400">"val/loss"</span>: <span class="text-orange-500">0.55</span>&#125;)
tracker.<span class="text-yellow-600 dark:text-yellow-400">finish</span>()</code></pre>
    </div>
  </div>

  <div>
    <!-- Stats -->
    <div class="max-w-2xl mx-auto mt-8 px-6">
      <div class="grid grid-cols-3 gap-4 mb-6">
        <div class="border border-border rounded-lg p-4 text-center">
          <p class="text-2xl font-bold tabular-nums">{stats.runs}</p>
          <p class="text-xs text-muted-foreground">Total Runs</p>
        </div>
        <div class="border border-border rounded-lg p-4 text-center">
          <p class="text-2xl font-bold tabular-nums text-green-600">{stats.activeRuns}</p>
          <p class="text-xs text-muted-foreground">Active Runs</p>
        </div>
        <div class="border border-border rounded-lg p-4 text-center">
          <p class="text-2xl font-bold tabular-nums">{stats.reports}</p>
          <p class="text-xs text-muted-foreground">Reports</p>
        </div>
      </div>

      <h2 class="text-sm font-semibold mb-3 text-foreground">Experiment Activity</h2>
      <div class="border border-border rounded-lg p-4 mb-8">
        <ActivityChart data={activity} />
      </div>
    </div>
  </div>
{/if}

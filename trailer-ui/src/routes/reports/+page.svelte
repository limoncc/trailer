<script lang="ts">
  import { onMount } from 'svelte';
  import { authReady } from '$lib/utils/auth';
  import PaginationBar from '$lib/components/PaginationBar.svelte';

  interface Report {
    id: string;
    project: string;
    title: string;
    body: string;
    created_at: number;
  }

  let reports = $state<Report[]>([]);
  let loading = $state(true);
  let page = $state(1);
  let perPage = $state(20);
  let total = $state(0);
  let inited = false;

  async function load() {
    try {
      const resp = await fetch(`/api/v1/reports?limit=${perPage}&offset=${(page - 1) * perPage}`);
      if (resp.ok) {
        total = Number(resp.headers.get('x-total-count') || 0);
        reports = await resp.json();
      }
    } catch {}
    loading = false;
  }

  // 翻页/每页条数变化 → 重新加载(首次由 onMount 处理)
  $effect(() => {
    page;
    perPage;
    if (!inited) { inited = true; return; }
    load();
  });

  onMount(async () => {
    await authReady();
    inited = true;
    load();
  });
</script>

<svelte:head><title>Reports — Trailer</title></svelte:head>

<div class="p-6">
  <div class="flex items-center justify-between mb-4">
    <div>
      <a href="/" class="text-sm text-muted-foreground hover:text-foreground mb-1 inline-block">← Back</a>
      <h1 class="text-xl font-bold">Reports</h1>
    </div>
    <a href="/reports/new" class="px-3 py-1 text-xs bg-primary text-primary-foreground rounded-md">+ New Report</a>
  </div>

  {#if loading}
    <p class="text-sm text-muted-foreground">Loading...</p>
  {:else if reports.length === 0}
    <p class="text-sm text-muted-foreground">No reports yet.</p>
  {:else}
    <div class="grid gap-3">
      {#each reports as r (r.id)}
        <a href="/reports/{r.id}" class="block border border-border rounded-md p-4 hover:bg-accent/30 transition-colors no-underline">
          <h2 class="font-semibold text-foreground">{r.title}</h2>
          <p class="text-xs text-muted-foreground mt-1">{r.project} · {new Date(r.created_at * 1000).toLocaleDateString()}</p>
        </a>
      {/each}
    </div>
    <PaginationBar bind:page bind:perPage {total} />
  {/if}
</div>

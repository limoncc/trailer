<script lang="ts">
  import { onMount } from 'svelte';
  import { authReady } from '$lib/utils/auth';
  import PaginationBar from '$lib/components/PaginationBar.svelte';

  interface SweepGroup {
    sweep_id: string;
    run_count: number;
    run_ids: string[];
    config_keys: string[];
  }

  let sweeps = $state<SweepGroup[]>([]);
  let loading = $state(true);
  let page = $state(1);
  let perPage = $state(20);
  let total = $state(0);
  let inited = false;

  async function load() {
    try {
      const resp = await fetch(`/api/v1/sweeps?limit=${perPage}&offset=${(page - 1) * perPage}`);
      if (resp.ok) {
        total = Number(resp.headers.get('x-total-count') || 0);
        sweeps = await resp.json();
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

<svelte:head><title>Sweeps — Trailer</title></svelte:head>

<div class="p-6">
  <a href="/" class="text-sm text-muted-foreground hover:text-foreground mb-2 inline-block">← Back</a>
  <h1 class="text-xl font-bold mb-4">Hyperparameter Sweeps</h1>

  {#if loading}
    <p class="text-muted-foreground text-sm">Loading...</p>
  {:else if sweeps.length === 0}
    <p class="text-muted-foreground text-sm">
      No sweeps found. Use <code class="text-xs bg-muted px-1 rounded">tracker = Tracker(sweep_id="sweep-1")</code> to group runs.
    </p>
  {:else}
    <div class="grid gap-4">
      {#each sweeps as s (s.sweep_id)}
        <a href="/sweeps/{s.sweep_id}" class="block border border-border rounded-md p-4 hover:bg-accent/30 transition-colors no-underline">
          <div class="flex items-center justify-between">
            <div>
              <h2 class="font-mono font-semibold text-foreground">{s.sweep_id}</h2>
              <p class="text-xs text-muted-foreground mt-1">{s.run_count} runs · {s.config_keys.length} parameters</p>
            </div>
            <span class="text-xs text-muted-foreground">→</span>
          </div>
          {#if s.config_keys.length > 0}
            <div class="flex gap-1 mt-2 flex-wrap">
              {#each s.config_keys.slice(0, 6) as key}
                <span class="px-1.5 py-0.5 rounded bg-muted text-[10px] text-muted-foreground">{key}</span>
              {/each}
              {#if s.config_keys.length > 6}
                <span class="text-[10px] text-muted-foreground">+{s.config_keys.length - 6} more</span>
              {/if}
            </div>
          {/if}
        </a>
      {/each}
    </div>
    <PaginationBar bind:page bind:perPage {total} />
  {/if}
</div>

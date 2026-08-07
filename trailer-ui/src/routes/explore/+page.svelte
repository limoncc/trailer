<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { api } from '$lib/utils/api';
  import PaginationBar from '$lib/components/PaginationBar.svelte';

  interface ExploreItem {
    id: string;
    title: string;
    description: string;
    run_ids: string;
    chart_defs: string;
    updated_at: number;
  }

  let explores = $state<ExploreItem[]>([]);
  let loading = $state(true);
  let error = $state('');
  let page = $state(1);
  let perPage = $state(20);
  let total = $state(0);
  let inited = false;

  function parseJson(s: string): unknown[] {
    try {
      const v = JSON.parse(s);
      return Array.isArray(v) ? v : [];
    } catch {
      return [];
    }
  }

  async function load() {
    try {
      const resp = await api(`/api/v1/explores?limit=${perPage}&offset=${(page - 1) * perPage}`);
      if (resp.ok) {
        total = Number(resp.headers.get('x-total-count') || 0);
        explores = await resp.json();
      } else {
        error = `Failed to load (HTTP ${resp.status}) — the backend may not include explore support, please update trailer and restart the server`;
      }
    } catch (e) {
      error = `Failed to load: ${e instanceof Error ? e.message : String(e)}`;
    } finally {
      loading = false;
    }
  }

  // 翻页/每页条数变化 → 重新加载(首次由 onMount 处理)
  $effect(() => {
    page;
    perPage;
    if (!inited) { inited = true; return; }
    load();
  });

  onMount(() => {
    inited = true;
    load();
  });

  async function remove(id: string) {
    if (!confirm('Delete this analysis?')) return;
    const resp = await api(`/api/v1/explores/${id}`, { method: 'DELETE' });
    if (resp.ok) explores = explores.filter((e) => e.id !== id);
  }
</script>

<div class="p-4">
  <div class="flex items-center justify-between mb-4">
    <h1 class="text-lg font-bold">Explore Analyses</h1>
    <button
      type="button"
      onclick={() => goto('/explore/new')}
      class="inline-flex items-center gap-1 px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded-md hover:opacity-90 transition-opacity"
    >
      <svg class="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14"/><path d="M12 5v14"/></svg>
      New Analysis
    </button>
  </div>

  {#if loading}
    <p class="text-center text-muted-foreground py-10 text-sm">Loading...</p>
  {:else if error}
    <div class="border border-destructive/40 bg-destructive/5 rounded-md p-4 text-sm text-destructive">
      {error}
    </div>
  {:else if explores.length === 0}
    <div class="border border-dashed rounded-md p-10 text-center text-sm text-muted-foreground">
      No analyses yet. Click "New Analysis" to create the first one.
    </div>
  {:else}
    <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {#each explores as e (e.id)}
        <div class="border border-border rounded-lg overflow-hidden bg-card">
          <div
            role="button"
            tabindex="0"
            class="px-3 py-2 border-b border-border bg-muted/20 cursor-pointer hover:bg-muted/40"
            onclick={() => goto(`/explore/${e.id}`)}
            onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); goto(`/explore/${e.id}`); } }}
          >
            <div class="text-sm font-semibold truncate">{e.title}</div>
            <div class="text-xs text-muted-foreground truncate">{e.description || '—'}</div>
          </div>
          <div class="px-3 py-2 flex items-center justify-between text-xs text-muted-foreground">
            <span>{parseJson(e.run_ids).length} runs · {parseJson(e.chart_defs).length} charts</span>
            <button type="button" onclick={() => remove(e.id)} class="text-destructive hover:underline">Delete</button>
          </div>
        </div>
      {/each}
    </div>
    <PaginationBar bind:page bind:perPage {total} />
  {/if}
</div>

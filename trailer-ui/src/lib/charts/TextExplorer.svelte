<script lang="ts">
  import MarkdownRenderer from '$lib/components/MarkdownRenderer.svelte';
  import { authReady } from '$lib/utils/auth';

  interface TextRow {
    run_id: string;
    step: number;
    name: string;
    body: string;
  }

  interface Props {
    runId: string;
    name?: string;
    afterStep?: number;
  }

  let { runId, name = '', afterStep = undefined }: Props = $props();

  let texts = $state<TextRow[]>([]);
  let loading = $state(true);
  let error = $state('');
  let visibleCount = $state(50);
  let columns = $state<1 | 2 | 3 | 4>(1);
  let collapsed = $state<Set<number>>(new Set());
  let hoveredStep = $state<number | null>(null);

  async function loadTexts() {
    await authReady();
    loading = true;
    error = '';
    try {
      if (!runId) return;
      const params = new URLSearchParams();
      if (name) params.set('name', name);
      if (afterStep !== undefined) params.set('after_step', String(afterStep));
      const resp = await fetch(`/api/v1/runs/${encodeURIComponent(runId)}/texts?${params}`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data: TextRow[] = await resp.json();
      texts = data;
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to load texts';
    } finally {
      loading = false;
    }
  }

  function loadMore() {
    visibleCount += 50;
  }

  function toggleStep(step: number) {
    const next = new Set(collapsed);
    if (next.has(step)) next.delete(step); else next.add(step);
    collapsed = next;
  }

  $effect(() => {
    if (runId) loadTexts();
  });
</script>

<div class="text-explorer">
  {#if loading}
    <p class="text-center text-muted-foreground py-8 text-sm">Loading texts...</p>
  {:else if error}
    <div class="text-center py-8">
      <p class="text-sm text-destructive">{error}</p>
      <button
        onclick={loadTexts}
        class="mt-2 px-3 py-1 text-xs border border-border rounded-md hover:bg-accent"
      >
        Retry
      </button>
    </div>
  {:else if texts.length === 0}
    <p class="text-center text-muted-foreground py-8 text-sm">No text entries found</p>
  {:else}
    <!-- Column layout toggle -->
    <div class="flex items-center gap-2 mb-3">
      <div class="flex items-center gap-0.5 border border-border rounded-md overflow-hidden ml-auto">
        <button class="px-2 py-1 text-xs {columns === 1 ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50'}" onclick={() => columns = 1}>1</button>
        <button class="px-2 py-1 text-xs {columns === 2 ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50'}" onclick={() => columns = 2}>2</button>
        <button class="px-2 py-1 text-xs {columns === 3 ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50'}" onclick={() => columns = 3}>3</button>
        <button class="px-2 py-1 text-xs {columns === 4 ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50'}" onclick={() => columns = 4}>4</button>
      </div>
    </div>

    <!-- Grid of step cards -->
    <div class="grid gap-3" style="grid-template-columns: repeat({columns}, minmax(0, 1fr))">
      {#each texts.slice(0, visibleCount) as entry (entry.step + entry.body)}
        {@const isCollapsed = collapsed.has(entry.step)}
        <div
          role="button"
          tabindex="0"
          class="border rounded-md overflow-hidden transition-colors cursor-pointer"
          class:border-border={hoveredStep !== entry.step}
          style={hoveredStep === entry.step ? 'border-color:#ec4899;background-color:rgba(236,72,153,0.06)' : ''}
          onmouseenter={() => hoveredStep = entry.step}
          onmouseleave={() => { if (hoveredStep === entry.step) hoveredStep = null; }}
          onclick={() => toggleStep(entry.step)}
          onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleStep(entry.step); } }}
        >
          <!-- Header: step + name + expand/collapse indicator -->
          <div class="flex items-center gap-2 px-3 py-1.5 bg-muted/30 text-xs text-muted-foreground border-b border-border">
            <span class="font-mono font-medium shrink-0">Step {entry.step}</span>
            {#if entry.name}
              <span class="font-mono truncate shrink-0">{entry.name}</span>
            {/if}
            <span class="ml-auto shrink-0">{isCollapsed ? '▶' : '▼'}</span>
          </div>
          <!-- Body: rendered when expanded -->
          {#if !isCollapsed}
            <div class="px-3 py-2 text-sm leading-relaxed" role="presentation" onclick={(e) => e.stopPropagation()}>
              <MarkdownRenderer content={entry.body} />
            </div>
          {/if}
        </div>
      {/each}
    </div>

    {#if visibleCount < texts.length}
      <div class="text-center mt-4">
        <button
          onclick={loadMore}
          class="px-4 py-2 text-xs border border-border rounded-md hover:bg-accent transition-colors"
        >
          Show More ({texts.length - visibleCount} remaining)
        </button>
      </div>
    {/if}

    <p class="text-xs text-muted-foreground mt-2">{texts.length} entries</p>
  {/if}
</div>

<script lang="ts">
  import G2SpecChart from './G2SpecChart.svelte';

  interface FigureRow {
    run_id: string;
    step: number;
    name: string;
    kind: 'png' | 'g2';
    body: string;
  }

  interface Props {
    runId: string;
  }

  let { runId }: Props = $props();

  let figures = $state<FigureRow[]>([]);
  let loading = $state(true);
  let error = $state('');

  async function loadFigures() {
    loading = true;
    error = '';
    try {
      if (!runId) return;
      const resp = await fetch(`/api/v1/runs/${encodeURIComponent(runId)}/figures`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      // 防御过滤：只渲染 png/g2，避免 pca/model 等其他 kind 串到 Figures tab
      figures = (await resp.json()).filter((f: any) => f.kind === 'png' || f.kind === 'g2');
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to load figures';
    } finally {
      loading = false;
    }
  }

  function parseSpec(body: string): Record<string, unknown> | null {
    try {
      return JSON.parse(body);
    } catch {
      return null;
    }
  }

  $effect(() => {
    if (runId) loadFigures();
  });
</script>

<div class="figure-explorer">
  {#if loading}
    <p class="text-center text-muted-foreground py-8 text-sm">Loading figures...</p>
  {:else if error}
    <div class="text-center py-8">
      <p class="text-sm text-destructive">{error}</p>
      <button
        onclick={loadFigures}
        class="mt-2 px-3 py-1 text-xs border border-border rounded-md hover:bg-accent"
      >
        Retry
      </button>
    </div>
  {:else if figures.length === 0}
    <p class="text-center text-muted-foreground py-8 text-sm">No figures recorded</p>
  {:else}
    <div class="space-y-6">
      {#each figures as fig (fig.name + fig.step)}
        <div class="border border-border rounded-md overflow-hidden">
          <div class="flex items-center gap-2 px-3 py-1.5 bg-muted/30 text-xs text-muted-foreground border-b border-border">
            <span class="font-mono font-medium">{fig.name}</span>
            <span class="px-1.5 py-0.5 rounded bg-muted text-xs">
              {fig.kind === 'g2' ? 'G2' : 'PNG'}
            </span>
            <span class="ml-auto font-mono">Step {fig.step}</span>
          </div>
          <div class="p-3">
            {#if fig.kind === 'png'}
              <img
                src="data:image/png;base64,{fig.body}"
                alt="{fig.name}"
                class="max-w-full h-auto rounded"
                loading="lazy"
              />
            {:else if fig.kind === 'g2'}
              {@const spec = parseSpec(fig.body)}
              {#if spec}
                <G2SpecChart {spec} height={300} />
              {:else}
                <p class="text-xs text-destructive">Invalid G2 spec</p>
              {/if}
            {/if}
          </div>
        </div>
      {/each}
    </div>

    <p class="text-xs text-muted-foreground mt-2">{figures.length} figures</p>
  {/if}
</div>

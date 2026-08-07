<script lang="ts">
  import ModelGraph from './ModelGraph.svelte';

  interface Props { runId: string; }
  let { runId }: Props = $props();

  let models = $state<Array<{ name: string; step: number; body: string }>>([]);
  let loading = $state(true);
  let error = $state('');
  let selectedModelName = $state<string | null>(null);

  async function loadModels() {
    loading = true;
    error = '';
    try {
      const resp = await fetch(`/api/v1/runs/${encodeURIComponent(runId)}/figures`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const all = await resp.json();
      models = all.filter((f: any) => f.kind === 'model');
      if (models.length > 0) selectedModelName = models[0].name;
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed';
    } finally {
      loading = false;
    }
  }

  function parseSpec(body: string): any | null {
    try { return JSON.parse(body); } catch { return null; }
  }

  let selectedSpec = $derived.by(() => {
    if (!selectedModelName) return null;
    const m = models.find(m => m.name === selectedModelName);
    return m ? parseSpec(m.body) : null;
  });

  $effect(() => { if (runId) loadModels(); });
</script>

<div class="h-full flex flex-col">
  {#if loading}
    <p class="text-center text-muted-foreground py-8 text-sm">Loading model...</p>
  {:else if error}
    <p class="text-center text-destructive py-8 text-sm">{error}</p>
    <div class="text-center"><button onclick={loadModels} class="text-xs underline">Retry</button></div>
  {:else if models.length === 0}
    <p class="text-center text-muted-foreground py-8 text-sm">No model logged. Use <code class="text-xs bg-muted px-1 rounded">tracker.log_model(model)</code></p>
  {:else}
    {#if models.length > 1}
      <div class="flex gap-2 mb-4 flex-wrap">
        {#each models as m (m.name + m.step)}
          <button
            onclick={() => selectedModelName = m.name}
            class="px-3 py-1.5 text-xs rounded-md border transition-colors
              {selectedModelName === m.name ? 'bg-primary text-primary-foreground border-primary' : 'bg-background border-border hover:bg-accent'}"
          >{m.name}</button>
        {/each}
      </div>
    {/if}

    {#if selectedSpec}
      <ModelGraph spec={selectedSpec} />
    {:else}
      <p class="text-center text-muted-foreground py-4 text-sm">Invalid model spec</p>
    {/if}
  {/if}
</div>

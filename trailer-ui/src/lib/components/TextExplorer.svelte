<script lang="ts">
  interface TextItem {
    run_id: string;
    step: number;
    name: string;
    body: string;
  }

  let { runId }: { runId: string } = $props();
  let texts = $state<TextItem[]>([]);
  let loading = $state(true);
  let selectedStep = $state<number | null>(null);

  async function load() {
    loading = true;
    try {
      const resp = await fetch(`/api/v1/runs/${runId}/texts?limit=200`);
      texts = await resp.json();
    } catch (_) {
      texts = [];
    }
    loading = false;
  }

  $effect(() => { load(); });

  function select(text: TextItem) {
    selectedStep = text.step;
  }
</script>

<div class="flex h-full">
  <!-- Sidebar: text list -->
  <div class="w-64 border-r border-gray-200 dark:border-gray-700 overflow-y-auto">
    {#if loading}
      <p class="p-4 text-sm text-gray-400">Loading...</p>
    {:else if texts.length === 0}
      <p class="p-4 text-sm text-gray-400">No text samples</p>
    {:else}
      {#each texts as t (t.step)}
        <button
          class="w-full text-left px-3 py-2 text-xs border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800 {selectedStep === t.step ? 'bg-blue-50 dark:bg-blue-900/30' : ''}"
          onclick={() => select(t)}
        >
          <span class="font-mono text-gray-400">step {t.step}</span>
          <span class="ml-2 text-gray-600 dark:text-gray-300 truncate block">{t.body.slice(0, 60)}</span>
        </button>
      {/each}
    {/if}
  </div>

  <!-- Main: selected text -->
  <div class="flex-1 p-4 overflow-y-auto">
    {#if selectedStep != null}
      {@const selected = texts.find(t => t.step === selectedStep)}
      {#if selected}
        <div class="text-xs text-gray-400 mb-2">step {selected.step} · {selected.name}</div>
        <div class="prose prose-sm dark:prose-invert max-w-none whitespace-pre-wrap font-mono text-sm bg-gray-50 dark:bg-gray-800 p-4 rounded-lg">
          {selected.body}
        </div>
      {/if}
    {:else}
      <div class="flex items-center justify-center h-full text-gray-400 text-sm">
        Select a text sample from the list
      </div>
    {/if}
  </div>
</div>

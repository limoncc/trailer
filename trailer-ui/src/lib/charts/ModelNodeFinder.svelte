<script lang="ts">
  import { Search } from 'lucide-svelte';

  interface Props {
    nodeById: Record<string, any>;
    onpick: (id: string) => void;
    onclose: () => void;
  }
  let { nodeById, onpick, onclose }: Props = $props();

  let query = $state('');
  let inputEl = $state<HTMLInputElement>();

  $effect(() => {
    inputEl?.focus();
  });

  const results = $derived.by(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const out: Array<{ id: string; name: string; cls: string }> = [];
    for (const id of Object.keys(nodeById)) {
      const n = nodeById[id];
      if (
        id.toLowerCase().includes(q) ||
        (n.class || '').toLowerCase().includes(q) ||
        (n.name || '').toLowerCase().includes(q)
      ) {
        out.push({ id, name: n.name || id, cls: n.class || '' });
        if (out.length >= 8) break;
      }
    }
    return out;
  });

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Enter' && results.length) onpick(results[0].id);
    else if (e.key === 'Escape') onclose();
  }
</script>

<div class="absolute top-3 left-3 z-20 w-80 rounded-lg border border-border bg-background shadow-lg">
  <div class="flex items-center gap-2 px-3 py-2 border-b border-border">
    <Search class="w-3.5 h-3.5 text-muted-foreground shrink-0" />
    <!-- svelte-ignore a11y_autofocus -->
    <input
      bind:this={inputEl}
      bind:value={query}
      autofocus
      onkeydown={onKey}
      placeholder="Jump to module — path or class…"
      class="w-full bg-transparent text-xs outline-none placeholder:text-muted-foreground/60"
    />
    <kbd class="text-[10px] font-mono text-muted-foreground/60 shrink-0">esc</kbd>
  </div>
  {#if query.trim()}
    {#if results.length}
      <div class="max-h-64 overflow-y-auto py-1">
        {#each results as r (r.id)}
          <button
            class="w-full text-left px-3 py-1.5 hover:bg-muted/60 flex flex-col gap-0.5"
            onclick={() => onpick(r.id)}
          >
            <span class="text-xs font-medium truncate">{r.name}</span>
            <span class="text-[10px] font-mono text-muted-foreground truncate">{r.id}{r.cls ? ` · ${r.cls}` : ''}</span>
          </button>
        {/each}
      </div>
    {:else}
      <div class="px-3 py-3 text-xs text-muted-foreground">No module matches "{query}"</div>
    {/if}
  {:else}
    <div class="px-3 py-3 text-[11px] text-muted-foreground">Type to search by path or class name</div>
  {/if}
</div>

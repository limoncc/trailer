<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import type { RunRecord } from '$lib/utils/explore';

  interface Props {
    runs: RunRecord[];
    selected: Set<string>;
    onselect: (runId: string, checked: boolean) => void;
    onclear: () => void;
  }
  let { runs, selected, onselect, onclear }: Props = $props();

  let open = $state(false);
  let query = $state('');
  let collapsed = $state<Set<string>>(new Set());
  let container: HTMLDivElement;

  function onDocClick(e: MouseEvent) {
    if (open && container && !container.contains(e.target as Node)) {
      open = false;
    }
  }

  onMount(() => window.addEventListener('click', onDocClick));
  onDestroy(() => window.removeEventListener('click', onDocClick));

  const projects = $derived([...new Set(runs.map((r) => r.project))].sort());

  const filtered = $derived.by(() => {
    const q = query.trim().toLowerCase();
    if (!q) return runs;
    return runs.filter(
      (r) => r.name?.toLowerCase().includes(q) || r.run_id.toLowerCase().includes(q),
    );
  });

  const byProject = $derived.by(() => {
    const map = new Map<string, RunRecord[]>();
    for (const r of filtered) {
      if (!map.has(r.project)) map.set(r.project, []);
      map.get(r.project)!.push(r);
    }
    return map;
  });

  const selectedRuns = $derived(runs.filter((r) => selected.has(r.run_id)));

  function toggleProject(p: string) {
    const next = new Set(collapsed);
    if (next.has(p)) next.delete(p);
    else next.add(p);
    collapsed = next;
  }
</script>

<div class="relative" bind:this={container}>
  <button
    type="button"
    onclick={(e) => {
      e.stopPropagation();
      open = !open;
    }}
    class="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs border border-border rounded-md bg-background hover:bg-accent/50 transition-colors"
  >
    Runs
    <span class="inline-flex items-center justify-center min-w-4 h-4 px-1 rounded-full text-[10px] bg-primary text-primary-foreground">
      {selected.size}
    </span>
    <svg class="size-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m6 9 6 6 6-6"/></svg>
  </button>

  {#if open}
    <div class="absolute left-0 top-full mt-1 w-80 bg-card border border-border rounded-md shadow-lg z-30 flex flex-col max-h-96">
      <div class="px-2 py-1.5 border-b border-border flex items-center gap-1.5">
        <input
          bind:value={query}
          placeholder="Search runs..."
          class="w-full text-xs px-2 py-1 border border-border rounded bg-background"
        />
        <button type="button" onclick={onclear} class="text-xs text-destructive hover:underline shrink-0">
          Clear
        </button>
      </div>

      <div class="overflow-y-auto flex-1 px-1 py-1">
        {#each projects as proj (proj)}
          {@const rows = byProject.get(proj) ?? []}
          {#if rows.length > 0}
            <button
              type="button"
              onclick={() => toggleProject(proj)}
              class="w-full flex items-center gap-1 px-1.5 py-1 text-xs font-semibold text-muted-foreground hover:bg-accent/50 rounded"
            >
              <svg class="size-3 transition-transform {collapsed.has(proj) ? '-rotate-90' : ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m6 9 6 6 6-6"/></svg>
              {proj}
              <span class="ml-auto text-[10px]">{rows.length}</span>
            </button>
            {#if !collapsed.has(proj)}
              {#each rows as r (r.run_id)}
                <label class="flex items-center gap-2 px-2 py-1 text-xs cursor-pointer hover:bg-accent rounded">
                  <input
                    type="checkbox"
                    class="accent-primary"
                    checked={selected.has(r.run_id)}
                    onchange={(e) => onselect(r.run_id, (e.target as HTMLInputElement).checked)}
                  />
                  <span class="truncate">{r.name || r.run_id}</span>
                </label>
              {/each}
            {/if}
          {/if}
        {/each}
      </div>

      {#if selectedRuns.length > 0}
        <div class="border-t border-border p-1.5 flex flex-wrap gap-1 overflow-y-auto max-h-24">
          {#each selectedRuns as r (r.run_id)}
            <span class="inline-flex items-center gap-1 px-1.5 py-0.5 text-[11px] bg-accent text-accent-foreground rounded-full">
              <span class="max-w-24 truncate">{r.name || r.run_id}</span>
              <button type="button" onclick={() => onselect(r.run_id, false)} class="hover:text-destructive">×</button>
            </span>
          {/each}
        </div>
      {/if}
    </div>
  {/if}
</div>

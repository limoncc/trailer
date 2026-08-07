<script lang="ts">
  interface TableRow {
    id: number;
    run_id: string;
    step: number;
    name: string;
    columns: string[];
    data: unknown[][];
    row_count: number;
  }

  interface Props {
    runId: string;
  }

  let { runId }: Props = $props();

  let tables = $state<TableRow[]>([]);
  let loading = $state(true);
  let error = $state('');
  let selectedTableId = $state<number | null>(null);
  let visibleRows = $state(100);

  let selectedTable = $derived(
    tables.find(t => t.id === selectedTableId) ?? tables[0] ?? null
  );

  async function loadTables() {
    loading = true;
    error = '';
    try {
      if (!runId) return;
      const resp = await fetch(`/api/v1/runs/${encodeURIComponent(runId)}/tables`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      tables = await resp.json();
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to load tables';
    } finally {
      loading = false;
    }
  }

  function selectTable(id: number) {
    selectedTableId = id;
    visibleRows = 100;
  }

  function showMore() {
    visibleRows += 100;
  }

  function formatCell(val: unknown): string {
    if (val === null || val === undefined) return '—';
    if (typeof val === 'number') return val.toPrecision(4);
    return String(val);
  }

  $effect(() => {
    if (runId) loadTables();
  });
</script>

<div class="table-explorer">
  {#if loading}
    <p class="text-center text-muted-foreground py-8 text-sm">Loading tables...</p>
  {:else if error}
    <div class="text-center py-8">
      <p class="text-sm text-destructive">{error}</p>
      <button
        onclick={loadTables}
        class="mt-2 px-3 py-1 text-xs border border-border rounded-md hover:bg-accent"
      >Retry</button>
    </div>
  {:else if tables.length === 0}
    <p class="text-center text-muted-foreground py-8 text-sm">No tables recorded</p>
  {:else}
    <!-- Table selector -->
    <div class="flex gap-2 mb-3 flex-wrap">
      {#each tables as t (t.id)}
        <button
          class="px-3 py-1 text-xs rounded-md border {selectedTable?.id === t.id ? 'bg-primary text-primary-foreground border-primary' : 'border-border hover:bg-accent'}"
          onclick={() => selectTable(t.id)}
        >
          {t.name} <span class="opacity-70">(Step {t.step})</span>
        </button>
      {/each}
    </div>

    {#if selectedTable}
      <div class="border border-border rounded-md overflow-hidden">
        <div class="overflow-x-auto">
          <table class="w-full text-xs font-mono border-collapse">
            <thead>
              <tr class="bg-muted/50">
                <th class="px-2 py-1.5 text-left text-muted-foreground font-medium sticky top-0 bg-muted/50 border-b border-border">#</th>
                {#each selectedTable.columns as col}
                  <th class="px-2 py-1.5 text-left text-muted-foreground font-medium sticky top-0 bg-muted/50 border-b border-border whitespace-nowrap">{col}</th>
                {/each}
              </tr>
            </thead>
            <tbody>
              {#each selectedTable.data.slice(0, visibleRows) as row, i}
                <tr class="border-b border-border/50 hover:bg-accent/30 even:bg-muted/10">
                  <td class="px-2 py-1 text-muted-foreground">{i}</td>
                  {#each row as cell}
                    <td class="px-2 py-1 whitespace-nowrap">{formatCell(cell)}</td>
                  {/each}
                </tr>
              {/each}
            </tbody>
          </table>
        </div>

        {#if selectedTable.data.length > visibleRows}
          <div class="text-center py-2 border-t border-border">
            <button
              onclick={showMore}
              class="px-3 py-1 text-xs text-muted-foreground hover:text-foreground"
            >
              Show {Math.min(100, selectedTable.data.length - visibleRows)} more ({selectedTable.data.length - visibleRows} remaining)
            </button>
          </div>
        {/if}
      </div>
      <p class="text-xs text-muted-foreground mt-1">
        {selectedTable.data.length} rows &times; {selectedTable.columns.length} columns
      </p>
    {/if}
  {/if}
</div>


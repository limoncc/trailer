<script lang="ts">
  let {
    total = 0,
    page = $bindable(1),
    perPage = $bindable(20),
  }: { total: number; page: number; perPage: number } = $props();

  const PAGE_SIZES = [10, 20, 50, 100];

  let totalPages = $derived(Math.max(1, Math.ceil(total / perPage)));

  // 页码窗口:当前页前后各 3 个,超出用省略号,首末页常显
  let pages = $derived.by(() => {
    const cur = Math.min(page, totalPages);
    const start = Math.max(1, cur - 3);
    const end = Math.min(totalPages, start + 6);
    const arr: (number | '…')[] = [];
    if (start > 1) arr.push(1, '…');
    for (let i = start; i <= end; i++) arr.push(i);
    if (end < totalPages) arr.push('…', totalPages);
    return arr;
  });

  function goto(p: number) {
    page = Math.max(1, Math.min(totalPages, p));
  }
  function changeSize(v: number) {
    perPage = v;
    page = 1;
  }
</script>

{#if total > 0}
  <div class="flex items-center justify-between gap-3 flex-wrap px-1 py-2 text-xs text-muted-foreground">
    <span>{total} items</span>
    <div class="flex items-center gap-1">
      <span class="shrink-0">Rows per page:</span>
      <select
        value={perPage}
        onchange={(e) => changeSize(Number((e.currentTarget as HTMLSelectElement).value))}
        class="px-1.5 py-0.5 text-xs border border-border rounded-md bg-background"
      >
        {#each PAGE_SIZES as s}
          <option value={s}>{s}</option>
        {/each}
      </select>
    </div>
    <nav class="flex items-center gap-1" aria-label="pagination">
      <button
        type="button"
        disabled={page <= 1}
        onclick={() => goto(page - 1)}
        class="px-2 py-1 border border-border rounded-md hover:bg-accent disabled:opacity-30"
        aria-label="Previous"
      >‹</button>
      {#each pages as p}
        {#if p === '…'}
          <span class="px-1 select-none">…</span>
        {:else}
          <button
            type="button"
            onclick={() => goto(p)}
            class="px-2 py-1 border rounded-md {p === page ? 'bg-primary text-primary-foreground border-primary' : 'border-border hover:bg-accent'}"
          >{p}</button>
        {/if}
      {/each}
      <button
        type="button"
        disabled={page >= totalPages}
        onclick={() => goto(page + 1)}
        class="px-2 py-1 border border-border rounded-md hover:bg-accent disabled:opacity-30"
        aria-label="Next"
      >›</button>
    </nav>
  </div>
{/if}

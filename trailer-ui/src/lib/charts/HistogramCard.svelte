<script lang="ts">
  import HistogramChart from './HistogramChart.svelte';
  import type { HistogramPoint } from './HistogramChart.svelte';

  interface Props {
    label: string;
    data: HistogramPoint[];
    compact?: boolean;
    onMoveUp?: () => void;
    onMoveDown?: () => void;
    onRemove?: () => void;
  }

  let { label, data, compact = false, onMoveUp, onMoveDown, onRemove }: Props = $props();
  let expanded = $state(true);
</script>

<div class="border border-border rounded-md overflow-hidden">
  <!-- Header -->
  <div class="flex items-center gap-2 px-3 py-2 bg-muted/20 border-b border-border">
    <button
      class="text-xs text-muted-foreground hover:text-foreground transition-colors"
      onclick={() => expanded = !expanded}
    >
      {expanded ? '▼' : '▶'}
    </button>
    <span class="text-sm font-medium flex-1 font-mono">{label}</span>
    {#if onMoveUp}
      <button class="text-xs text-muted-foreground hover:text-foreground" onclick={onMoveUp} title="Move up">↑</button>
    {/if}
    {#if onMoveDown}
      <button class="text-xs text-muted-foreground hover:text-foreground" onclick={onMoveDown} title="Move down">↓</button>
    {/if}
    {#if onRemove}
      <button class="text-xs text-muted-foreground hover:text-destructive" onclick={onRemove} title="Hide">✕</button>
    {/if}
  </div>

  <!-- Content -->
  {#if expanded}
    <div class="p-2">
      <HistogramChart data={data} key="" {compact} />
    </div>
  {/if}
</div>

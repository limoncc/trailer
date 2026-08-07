<script lang="ts">
  import { inview } from '$lib/utils/inview';
  import LineChart from './LineChart.svelte';

  interface Point {
    step: number;
    wall_time?: number;
    value: number;
    idx: number;
  }

  interface Props {
    key: string;
    context: string;
    data: Point[];
    seriesField?: string;          // for multi-run overlay
    colors?: string[];             // palette for multi-series
    running?: boolean;
    compact?: boolean;             // hide controls when true
    onRemove?: () => void;
    onMoveUp?: () => void;
    onMoveDown?: () => void;
  }

  let {
    key,
    context,
    data,
    seriesField,
    colors,
    running = false,
    compact = false,
    onRemove,
    onMoveUp,
    onMoveDown,
  }: Props = $props();

  let smooth = $state(0);
  let xField = $state<'step' | 'wall_time'>('step');
  let expanded = $state(true);
  let showChart = $derived(expanded || compact);

  let label = $derived(context ? `${key} [${context}]` : key);

  // When smoothing is enabled, produce long-form data with a series column
  // so G2 draws two separate lines (raw transparent + smoothed solid).
  // Skip smoothing when data already has series (multi-run mode).
  let chartData = $derived.by(() => {
    const mapped = data.map((p) => {
      const step = xField === 'wall_time' && (p as any).wall_time != null ? (p as any).wall_time * 1000 : p.step;
      return { step, value: p.value, idx: (p as any).idx, ...(p as any).series ? { series: (p as any).series } : {} };
    });
    if (seriesField || smooth < 1 || mapped.length < 2) return mapped;

    // Raw series
    const raw = mapped.map(p => ({ step: p.step, value: p.value, series: 'raw' }));
    // Smoothed series (simple moving average)
    const win = smooth * 2 + 1;
    const smoothed = mapped.map((p, i) => {
      const start = Math.max(0, i - Math.floor(win / 2));
      const end = Math.min(mapped.length, i + Math.ceil(win / 2));
      const slice = mapped.slice(start, end);
      const avg = slice.reduce((s, q) => s + q.value, 0) / slice.length;
      return { step: p.step, value: avg, series: 'smooth' };
    });
    return [...raw, ...smoothed].sort((a, b) => {
      if (a.series < b.series) return -1;
      if (a.series > b.series) return 1;
      return a.step - b.step;
    });
  });

  let hasWallTime = $derived(data.length > 0 && data[0].wall_time != null);

  // Compute latest-point markers for running experiments (green dot on chart)
  function getLatestMarkers(allData: any[], hasSeries: boolean): Array<{ step: number; value: number; color: string }> {
    if (!hasSeries || !allData.length) {
      // Single series: marker at last point
      const last = allData[allData.length - 1];
      return last ? [{ step: last.step, value: last.value, color: '#22c55e' }] : [];
    }
    // Dual series (raw + smooth): marker at the end of each
    const raw = allData.filter((d: any) => d.series === 'raw');
    const smooth = allData.filter((d: any) => d.series === 'smooth');
    const markers: Array<{ step: number; value: number; color: string }> = [];
    if (raw.length) {
      const last = raw[raw.length - 1];
      markers.push({ step: last.step, value: last.value, color: '#22c55e' });
    }
    if (smooth.length) {
      const last = smooth[smooth.length - 1];
      markers.push({ step: last.step, value: last.value, color: '#22c55e' });
    }
    return markers;
  }
</script>

<div use:inview class="border border-border rounded-md overflow-hidden">
  <!-- Header -->
  <div class="flex items-center gap-2 px-3 py-2 bg-muted/20 border-b border-border">
    {#if compact}
      <span class="text-sm font-medium flex-1">{label}</span>
    {:else}
      <button
        class="text-xs text-muted-foreground hover:text-foreground transition-colors"
        onclick={() => expanded = !expanded}
      >
        {expanded ? '▼' : '▶'}
      </button>
      <span class="text-sm font-medium flex-1">{label}</span>
      {#if onMoveUp}
        <button class="text-xs text-muted-foreground hover:text-foreground" onclick={onMoveUp} title="Move up">↑</button>
      {/if}
      {#if onMoveDown}
        <button class="text-xs text-muted-foreground hover:text-foreground" onclick={onMoveDown} title="Move down">↓</button>
      {/if}
      {#if onRemove}
        <button class="text-xs text-muted-foreground hover:text-destructive" onclick={onRemove} title="Hide metric">✕</button>
      {/if}
    {/if}
  </div>

  <!-- Controls -->
  {#if showChart && !compact}
    <div class="flex items-center gap-3 px-3 py-1.5 bg-muted/10 border-b border-border text-xs text-muted-foreground">
      {#if hasWallTime}
        <button
          class="underline hover:text-foreground"
          onclick={() => xField = xField === 'step' ? 'wall_time' : 'step'}
        >
          X: {xField === 'step' ? 'Step' : 'Wall Time'}
        </button>
      {/if}
      <span class="text-muted-foreground">{data.length} points</span>
      <div class="flex items-center gap-1 ml-auto">
        <button
          class="px-1.5 py-0.5 rounded hover:bg-accent"
          onclick={() => smooth = Math.max(0, smooth - 1)}
        >−</button>
        <span class="min-w-16 text-center">{smooth === 0 ? 'Raw' : `win=${smooth * 2 + 1}`}</span>
        <button
          class="px-1.5 py-0.5 rounded hover:bg-accent"
          onclick={() => smooth = Math.min(20, smooth + 1)}
        >+</button>
      </div>
    </div>
  {/if}

  <!-- Chart -->
  {#if showChart}
  <div class="p-2">
    <LineChart
      data={chartData}
      xField="step"
      yField="value"
      xIsTime={xField === 'wall_time'}
      seriesField={seriesField || (smooth >= 1 ? 'series' : undefined)}
      colors={colors || ['rgba(59,130,246,0.15)', '#3b82f6']}
      height={250}
      point={false}
      markers={running ? getLatestMarkers(chartData, seriesField ? true : smooth >= 1) : []}
    />
  </div>
  {/if}
</div>

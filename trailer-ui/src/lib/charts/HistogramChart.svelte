<script lang="ts">
  import { onDestroy } from 'svelte';
  import { Chart } from '@antv/g2';

  export interface HistogramPoint {
    run_id: string;
    step: number;
    wall_time: number;
    key: string;
    context: string;
    bucket_limits: number[];
    bucket_counts: number[];
    min: number;
    max: number;
    num: number;
    sum: number;
    sum_squares: number;
  }

  interface Stats {
    step: number; mean: number; std: number; skewness: number;
    p5: number; p95: number; min: number; max: number; max_abs: number;
  }

  const STAT_COLORS = { mean: '#3b82f6', std: '#22c55e', skewness: '#f97316' };
  const EXTREME_COLORS = { max: '#ef4444', min: '#06b6d4', p5: '#94a3b8', p95: '#94a3b8' };
  const FMT = (v: number) => { const s = String(v); const dot = s.indexOf('.'); return dot === -1 || s.length - dot - 1 <= 6 ? s : v.toFixed(6); };

  interface Props { data: HistogramPoint[]; key: string; context?: string; compact?: boolean; }
  let { data, key, context = '', compact = false }: Props = $props();

  let selectedStep = $state(0);
  let sliderWrap = $state<HTMLDivElement | null>(null);
  let dragging = false; // 非响应式: 仅在事件回调内使用, 避免闭包陷阱
  let barContainer = $state<HTMLDivElement | null>(null);
  let trendContainer = $state<HTMLDivElement | null>(null);
  let extremeContainer = $state<HTMLDivElement | null>(null);
  let barChart: Chart | null = null;
  let trendChart: Chart | null = null;
  let extremeChart: Chart | null = null;

  const sorted = $derived([...data].sort((a, b) => a.step - b.step));
  const steps = $derived(sorted.map(h => h.step));
  const stepInterval = $derived(sorted.length > 1 ? sorted[1].step - sorted[0].step : 1);
  const selectedIndex = $derived.by(() => {
    let idx = 0, md = Infinity;
    for (let i = 0; i < sorted.length; i++) { const d = Math.abs(sorted[i].step - selectedStep); if (d < md) { md = d; idx = i; } }
    return idx;
  });

  let initStep = true;
  $effect(() => {
    if (initStep && sorted.length > 0) {
      selectedStep = sorted[sorted.length - 1].step;
      initStep = false;
    }
  });

  // 自动播放：循环切换 step
  let playing = $state(false);
  let playTimer: ReturnType<typeof setInterval> | undefined;

  function togglePlay() {
    if (sorted.length < 2) return;
    playing = !playing;
    if (playing) {
      playTimer = setInterval(() => {
        const next = (selectedIndex + 1) % sorted.length;
        selectedStep = sorted[next].step;
      }, 700);
    } else {
      if (playTimer) clearInterval(playTimer);
      playTimer = undefined;
    }
  }

  onDestroy(() => {
    if (playTimer) clearInterval(playTimer);
  });

  // 滑块位置百分比
  const sliderPct = $derived(sorted.length > 1 ? (selectedIndex / (sorted.length - 1)) * 100 : 0);

  // 点击/拖动滑块: 由指针 x 位置 → index
  function setStepFromPointer(clientX: number) {
    const el = sliderWrap;
    if (!el || sorted.length < 2) return;
    const rect = el.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    const idx = Math.round(ratio * (sorted.length - 1));
    selectedStep = sorted[idx]?.step ?? selectedStep;
  }

  function pctile(limits: number[], counts: number[], total: number, p: number): number {
    if (total === 0 || limits.length === 0) return 0;
    const target = p * total;
    let cum = 0;
    if (target <= counts[0]) return (target / counts[0]) * limits[0];
    cum += counts[0];
    for (let i = 1; i < limits.length; i++) {
      const bw = limits[i] - limits[i - 1];
      if (bw <= 0) continue;
      if (target < cum + counts[i]) return limits[i - 1] + ((target - cum) / counts[i]) * bw;
      cum += counts[i];
    }
    return limits[limits.length - 1] * (1 + (target - cum) / Math.max(1, cum));
  }

  // Compute stats
  const stats = $derived(sorted.map(h => {
    const n = h.num || 1;
    const mn = h.sum / n;
    const v = Math.max(0, h.sum_squares / n - mn * mn);
    const sd = Math.sqrt(v);
    let m3 = 0;
    if (h.bucket_limits.length > 0 && h.bucket_counts.length > 0) {
      let prev = -Infinity;
      for (let i = 0; i < h.bucket_limits.length; i++) {
        const mid = prev === -Infinity ? h.bucket_limits[i] / 2 : (prev + h.bucket_limits[i]) / 2;
        m3 += Math.pow(mid - mn, 3) * h.bucket_counts[i];
        prev = h.bucket_limits[i];
      }
    }
    return {
      step: h.step, mean: mn, std: sd, skewness: sd > 1e-10 ? m3 / (n * sd * sd * sd) : 0,
      p5: pctile(h.bucket_limits, h.bucket_counts, n, 0.05),
      p95: pctile(h.bucket_limits, h.bucket_counts, n, 0.95),
      min: h.min, max: h.max, max_abs: h.min,
    } satisfies Stats;
  }));

  const current = $derived(sorted[selectedIndex]);
  const ss = $derived(stats[selectedIndex]);

  const barData = $derived.by(() => {
    if (!current) return [];
    const r: Array<{ v: number; range: string; count: number }> = [];
    let prev = -Infinity;
    for (let i = 0; i < current.bucket_limits.length; i++) {
      const mid = prev === -Infinity ? current.bucket_limits[i] / 2 : (prev + current.bucket_limits[i]) / 2;
      r.push({
        v: mid,
        range: prev === -Infinity ? `< ${current.bucket_limits[i].toFixed(2)}` : `[${prev.toFixed(2)}, ${current.bucket_limits[i].toFixed(2)})`,
        count: current.bucket_counts[i],
      });
      prev = current.bucket_limits[i];
    }
    return r;
  });

  const trend = $derived(stats.slice(0, selectedIndex + 1).flatMap((s, i) => [
    { step: i + 1, m: 'mean', v: s.mean },
    { step: i + 1, m: 'std', v: s.std },
    { step: i + 1, m: 'skewness', v: s.skewness },
  ]));

  const extremes = $derived(stats.slice(0, selectedIndex + 1).flatMap((s, i) => [
    { step: i + 1, m: 'max', v: s.max },
    { step: i + 1, m: 'min', v: s.min },
    { step: i + 1, m: 'p95', v: s.p95 },
    { step: i + 1, m: 'p5', v: s.p5 },
  ]));

  function renderBar() {
    if (!barChart) return;
    if (!barData.length) { barChart.clear(); barChart.render(); return; }
    barChart.options({
      type: 'interval', data: barData,
      encode: { x: 'v', y: 'count', color: 'count' },
      scale: { color: { palette: 'blues' }, x: { nice: true } },
      axis: compact ? { x: false, y: false } : { x: { title: 'Value', labelAutoHide: true, labelFontSize: 10 }, y: { title: 'Count' } },
      tooltip: { title: 'range', items: [{ field: 'count', name: 'Count', valueFormatter: FMT }] },
      legend: false, style: { radius: 2 },
    });
    barChart.render();
  }

  function renderTrend() {
    if (!trendChart || !trend.length) return;
    trendChart.options({
      type: 'line', data: trend,
      encode: { x: 'step', y: 'v', color: 'm' },
      scale: { color: { domain: ['mean', 'std', 'skewness'], range: [STAT_COLORS.mean, STAT_COLORS.std, STAT_COLORS.skewness] }, y: { nice: true } },
      axis: compact ? { x: false, y: false } : { x: { title: 'Step' }, y: { title: 'Value' } },
      legend: compact ? false : { color: { title: null, position: 'top', layout: { justifyContent: 'center' } } },
      tooltip: { crosshairs: true, items: [{ field: 'v', name: 'Value', valueFormatter: FMT }] },
      annotations: [{ type: 'lineX', data: [selectedIndex + 1], style: { stroke: '#94a3b8', lineDash: [4, 4], lineWidth: 1 } }],
    });
    trendChart.render();
  }

  function renderExtreme() {
    if (!extremeChart || !extremes.length) return;
    extremeChart.options({
      type: 'view', data: extremes.filter(d => d.m === 'max' || d.m === 'min'),
      children: [
        {
          type: 'line',
          encode: { x: 'step', y: 'v', color: 'm' },
          scale: { color: { domain: ['max', 'min'], range: [EXTREME_COLORS.max, EXTREME_COLORS.min] }, y: { nice: true } },
          axis: compact ? { x: false, y: false } : { x: { title: 'Step' }, y: { title: 'Value' } },
          legend: compact ? false : { color: { title: null, position: 'top', layout: { justifyContent: 'center' } } },
          tooltip: { crosshairs: true, items: [{ field: 'v', name: 'Value', valueFormatter: FMT }] },
        },
        {
          type: 'area', data: stats.slice(0, selectedIndex + 1).map((s, i) => ({ step: i + 1, y0: s.p5, y1: s.p95 })),
          encode: { x: 'step', y: ['y0', 'y1'] },
          style: { fill: EXTREME_COLORS.p5, fillOpacity: 0.15 },
          tooltip: false, legend: false,
        },
      ],
      annotations: [{ type: 'lineX', data: [selectedIndex + 1], style: { stroke: '#94a3b8', lineDash: [4, 4], lineWidth: 1 } }],
    });
    extremeChart.render();
  }

  // Reactive: create chart when container appears, re-render on data change
  $effect(() => {
    if (barContainer && barData.length > 0) {
      if (!barChart) barChart = new Chart({ container: barContainer, autoFit: true, height: 220 });
      renderBar();
    }
  });
  $effect(() => {
    if (trendContainer && trend.length > 0) {
      if (!trendChart) trendChart = new Chart({ container: trendContainer, autoFit: true, height: 220 });
      renderTrend();
    }
  });
  $effect(() => {
    if (extremeContainer && extremes.length > 0) {
      if (!extremeChart) extremeChart = new Chart({ container: extremeContainer, autoFit: true, height: 220 });
      renderExtreme();
    }
  });

  onDestroy(() => {
    barChart?.destroy(); trendChart?.destroy(); extremeChart?.destroy();
  });
</script>

<div class="w-full">
  {#if ss}
    <div class="grid grid-cols-4 gap-2 mb-3">
      <div class="rounded-lg border bg-card text-card-foreground shadow-sm p-2 text-center">
        <p class="text-[10px] text-muted-foreground">Mean</p>
        <p class="text-sm font-mono font-semibold" style="color:{STAT_COLORS.mean}">{ss.mean.toFixed(4)}</p>
      </div>
      <div class="rounded-lg border bg-card text-card-foreground shadow-sm p-2 text-center">
        <p class="text-[10px] text-muted-foreground">Std</p>
        <p class="text-sm font-mono font-semibold" style="color:{STAT_COLORS.std}">{ss.std.toFixed(4)}</p>
      </div>
      <div class="rounded-lg border bg-card text-card-foreground shadow-sm p-2 text-center">
        <p class="text-[10px] text-muted-foreground">Skewness</p>
        <p class="text-sm font-mono font-semibold" style="color:{STAT_COLORS.skewness}">{ss.skewness.toFixed(4)}</p>
      </div>
      <div class="rounded-lg border bg-card text-card-foreground shadow-sm p-2 text-center">
        <p class="text-[10px] text-muted-foreground">Min</p>
        <p class="text-sm font-mono font-semibold" style="color:{EXTREME_COLORS.min}">{ss.min.toFixed(4)}</p>
      </div>
    </div>
  {/if}

  {#if sorted.length > 1}
    <div class="flex items-center gap-4 mb-4 px-1">
      <span class="text-xs text-muted-foreground shrink-0 font-medium">Step {selectedIndex + 1}</span>
      <div
        bind:this={sliderWrap}
        role="slider"
        tabindex="0"
        aria-label="Step"
        aria-valuemin={0}
        aria-valuemax={Math.max(0, sorted.length - 1)}
        aria-valuenow={selectedIndex}
        aria-valuetext={`Step ${selectedIndex + 1} of ${sorted.length}`}
        class="trailer-slider relative h-5 flex-1 cursor-pointer touch-none select-none"
        onpointerdown={(e) => { dragging = true; setStepFromPointer(e.clientX); }}
        onpointermove={(e) => { if (dragging) setStepFromPointer(e.clientX); }}
        onpointerup={() => { dragging = false; }}
        onpointerleave={() => { dragging = false; }}
        onkeydown={(e) => {
          const step = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1 : 0;
          if (step === 0) return;
          e.preventDefault();
          const idx = Math.min(sorted.length - 1, Math.max(0, selectedIndex + step));
          selectedStep = sorted[idx]?.step ?? selectedStep;
        }}
      >
        <div class="absolute inset-y-0 left-0 my-auto h-1 w-full rounded-full bg-border"></div>
        <div class="absolute inset-y-0 left-0 my-auto h-1 rounded-full bg-primary" style="width: {sliderPct}%"></div>
        <div
          class="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-background bg-primary shadow"
          style="left: {sliderPct}%"
        ></div>
      </div>
      <span class="text-xs text-muted-foreground shrink-0 font-medium">{selectedIndex + 1} / {sorted.length}</span>
      <button
        type="button"
        class="shrink-0 px-1.5 text-[11px] border border-border rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
        onclick={togglePlay}
        aria-label={playing ? 'Pause' : 'Play'}
      >{playing ? '⏸' : '▶'}</button>
    </div>
  {/if}

  <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
    <div class="rounded-xl border bg-card text-card-foreground shadow-sm p-3">
      <p class="text-xs font-medium text-muted-foreground mb-2">Distribution at Step {selectedIndex + 1}</p>
      {#if barData.length > 0}
        <div bind:this={barContainer} class="w-full" style="height:220px"></div>
      {:else}
        <div class="flex items-center justify-center h-[220px] text-xs text-muted-foreground">No data at this step</div>
      {/if}
    </div>
    <div class="rounded-xl border bg-card text-card-foreground shadow-sm p-3">
      <p class="text-xs font-medium text-muted-foreground mb-2">Statistics Trends</p>
      {#if trend.length > 0}
        <div bind:this={trendContainer} class="w-full" style="height:220px"></div>
      {:else}
        <div class="flex items-center justify-center h-[220px] text-xs text-muted-foreground">No data</div>
      {/if}
    </div>
    <div class="rounded-xl border bg-card text-card-foreground shadow-sm p-3">
      <p class="text-xs font-medium text-muted-foreground mb-2">Extremes & Width</p>
      {#if extremes.length > 0}
        <div bind:this={extremeContainer} class="w-full" style="height:220px"></div>
      {:else}
        <div class="flex items-center justify-center h-[220px] text-xs text-muted-foreground">No data</div>
      {/if}
    </div>
  </div>
</div>

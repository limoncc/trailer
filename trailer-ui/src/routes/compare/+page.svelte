<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { page } from '$app/state';
  import LineChart from '$lib/charts/LineChart.svelte';
  import { ChartLine } from 'lucide-svelte';
  import { authReady } from '$lib/utils/auth';
  import { refreshInterval } from '$lib/refresh.svelte';
  import MetricPicker from '$lib/components/MetricPicker.svelte';
  import type { MetricRef } from '$lib/utils/explore';

  type MetricGroup = { key: string; context: string; points: Array<{ step: number; value: number; idx: number }> };
  type RunMetricSet = { run_id: string; name: string; metrics: MetricGroup[] };

  let runIds = $state<string[]>([]);
  let allRunMetrics = $state<RunMetricSet[]>([]);
  let runStates = $state<Record<string, string>>({});   // run_id → running/finished/crashed
  let maxSteps = $state<Record<string, number>>({});    // run_id → 已见最大 step(增量刷新用)
  let loading = $state(true);
  let smooth = $state(0);
  let columns = $state(2);
  // 渐进式加载进度(每个 run 数据到达即渲染)
  let loadedCount = $state(0);
  let totalRuns = $state(0);

  // Run selector dropdown
  let runMenuOpen = $state(false);
  let runFilter = $state('');
  let hiddenRuns = $state<Set<string>>(new Set());
  let activeRunIds = $derived(runIds.filter(id => !hiddenRuns.has(id)));

  // Metric selector
  let availableMetrics = $state<Array<{ key: string; context: string; points: never[]; selected: boolean }>>([]);

  $effect(() => {
    if (allRunMetrics.length === 0) return;
    const seen = new Map<string, { key: string; context: string }>();
    for (const rm of allRunMetrics) {
      for (const m of rm.metrics) {
        const id = `${m.key}|${m.context}`;
        if (!seen.has(id)) seen.set(id, { key: m.key, context: m.context });
      }
    }
    // 刷新(allRunMetrics 引用更新)时保留用户筛选状态, 新出现的指标默认选中
    // 用 untrack 读 availableMetrics: 避免本 effect 依赖自身写入的 state 造成无限循环
    const prev = untrack(() => new Map(availableMetrics.map(m => [`${m.key}|${m.context}`, m.selected])));
    availableMetrics = [...seen.values()].map(m => {
      const id = `${m.key}|${m.context}`;
      return { ...m, points: [], selected: prev.get(id) ?? true };
    });
  });

  // MetricPicker 适配: availableMetrics[].selected <-> selectedRefs
  const metricOptions = $derived(availableMetrics.map(m => ({ key: m.key, context: m.context })));
  const selectedRefs = $derived(
    availableMetrics.filter(m => m.selected).map(m => ({ key: m.key, context: m.context })),
  );
  function onMetricsChange(next: MetricRef[]) {
    const ids = new Set(next.map(m => `${m.key}|${m.context}`));
    availableMetrics = availableMetrics.map(m => ({ ...m, selected: ids.has(`${m.key}|${m.context}`) }));
  }

  let xField = $state<'step' | 'wall_time'>('step');

  let chartDataList = $derived.by(() => {
    const selected = availableMetrics.filter(m => m.selected);
    const isTime = xField === 'wall_time';
    return selected.map(sm => {
      const allPoints: Array<{ step: number; value: number; series: string }> = [];
      const win = smooth > 0 ? smooth * 2 + 1 : 0;
      // 运行中且可见的 run → 最后 raw 点作为闪烁 marker
      const markers: Array<{ step: number; value: number }> = [];
      for (const rm of allRunMetrics) {
        if (!activeRunIds.includes(rm.run_id)) continue;
        const match = rm.metrics.find(m => m.key === sm.key && m.context === sm.context);
        if (!match) continue;
        for (const p of match.points) {
          const x = isTime && (p as any).wall_time != null ? (p as any).wall_time * 1000 : p.step;
          allPoints.push({ step: x, value: p.value, series: `${rm.run_id}__raw` });
        }
        if (win >= 3 && match.points.length >= 2) {
          const smoothed = match.points.map((p, i) => {
            const start = Math.max(0, i - Math.floor(win / 2));
            const end = Math.min(match.points.length, i + Math.ceil(win / 2));
            const slice = match.points.slice(start, end);
            const avg = slice.reduce((s, q) => s + q.value, 0) / slice.length;
            const x = isTime && (p as any).wall_time != null ? (p as any).wall_time * 1000 : p.step;
            return { step: x, value: avg, series: `${rm.run_id}__smooth` };
          });
          allPoints.push(...smoothed);
        }
        if (runStates[rm.run_id] === 'running' && match.points.length > 0) {
          const last = match.points[match.points.length - 1];
          const x = isTime && (last as any).wall_time != null ? (last as any).wall_time * 1000 : last.step;
          markers.push({ step: x, value: last.value });
        }
      }
      allPoints.sort((a, b) => a.series < b.series ? -1 : a.series > b.series ? 1 : b.step - a.step);
      return { key: sm.key, context: sm.context, data: allPoints, markers };
    });
  });

  onMount(async () => {
    await authReady();
    const ids = page.url.searchParams.get('run_ids');
    if (!ids) { loading = false; return; }
    runIds = ids.split(',').filter(Boolean);
    if (runIds.length === 0) { loading = false; return; }
    totalRuns = runIds.length;
    loadedCount = 0;
    // 立即进入可交互状态(不再等任何数据请求, 消除首屏等待)
    loading = false;

    // run 状态(轻量端点, 只取这 N 个 run)与 metrics 并行, 均不阻塞首屏
    const stateP = fetch(`/api/v1/runs/states?run_ids=${encodeURIComponent(runIds.join(','))}`)
      .then(r => (r.ok ? r.json() : {}))
      .then((s: Record<string, string>) => { runStates = s; })
      .catch(() => {});

    // 并发请求所有 run; 每个 run 数据到达立即追加渲染, 不等全部完成
    await Promise.all([
      stateP,
      ...runIds.map(async (rid) => {
        try {
          const mr = await fetch(`/api/v1/metrics?run_id=${encodeURIComponent(rid)}&max_points=200`);
          if (mr.ok) {
            const metrics: MetricGroup[] = await mr.json();
            allRunMetrics = [...allRunMetrics, { run_id: rid, name: rid.slice(0, 12), metrics }];
            // 记录已见最大 step(增量刷新 after_step 用)
            const mx = metrics.reduce((m, g) => Math.max(m, g.points.reduce((s, p) => Math.max(s, p.step), 0)), 0);
            maxSteps = { ...maxSteps, [rid]: mx };
          }
        } catch (e) { console.error(e); }
        loadedCount += 1;
      }),
    ]);
  });

  /// 增量刷新运行中的 run: 只拉 after_step 之后的新点,按 metricId 去重追加
  async function refreshRunning() {
    const running = allRunMetrics.filter(rm => runStates[rm.run_id] === 'running');
    if (running.length === 0) return;
    const results = await Promise.all(running.map(async (rm) => {
      try {
        const url = `/api/v1/metrics?run_id=${encodeURIComponent(rm.run_id)}&max_points=200&after_step=${maxSteps[rm.run_id] ?? 0}`;
        const resp = await fetch(url);
        if (!resp.ok) return null;
        return { run_id: rm.run_id, points: await resp.json() as MetricGroup[] };
      } catch { return null; }
    }));
    const metricMap = new Map(allRunMetrics.map(rm => [rm.run_id, rm]));
    let changed = false;
    for (const r of results) {
      if (!r) continue;
      const target = metricMap.get(r.run_id);
      if (!target) continue;
      for (const inc of r.points) {
        const existing = target.metrics.find(m => m.key === inc.key && m.context === inc.context);
        if (existing) {
          const seen = new Set(existing.points.map(p => p.step));
          for (const p of inc.points) if (!seen.has(p.step)) { existing.points = [...existing.points, p]; changed = true; }
        } else {
          target.metrics = [...target.metrics, inc];
          changed = true;
        }
      }
      const last = target.metrics.reduce((mx, m) => Math.max(mx, m.points.reduce((s, p) => Math.max(s, p.step), 0)), maxSteps[r.run_id] ?? 0);
      if (last !== maxSteps[r.run_id]) { maxSteps = { ...maxSteps, [r.run_id]: last }; changed = true; }
    }
    if (changed) allRunMetrics = [...allRunMetrics];
  }

  // 实时刷新: 运行中的 run 按 refreshInterval 增量拉新点
  $effect(() => {
    if ($refreshInterval <= 0) return;
    const timer = setInterval(refreshRunning, $refreshInterval * 1000);
    return () => clearInterval(timer);
  });

  function toggleRun(rid: string) {
    const next = new Set(hiddenRuns);
    if (next.has(rid)) next.delete(rid); else next.add(rid);
    hiddenRuns = next;
  }

  function metricLabel(key: string, context: string): string {
    return context ? `${key} [${context}]` : key;
  }

  const BASE = ['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', '#ec4898', '#06b6d4', '#f97316'];
  let chartColors = $derived.by(() => {
    const palette: string[] = [];
    for (let i = 0; i < activeRunIds.length; i++) {
      const c = BASE[i % BASE.length];
      if (smooth > 0) palette.push(hexToRgba(c, 0.3));
      palette.push(c);
    }
    return palette;
  });

  function hexToRgba(hex: string, alpha: number): string {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }
</script>

<svelte:head><title>Compare — Trailer</title></svelte:head>

<div class="p-6">
  <a href="/" class="text-sm text-muted-foreground hover:text-foreground mb-2 inline-block">← Back</a>
  <h1 class="text-xl font-bold mb-4">Experiment Comparison</h1>

  {#if loading}
    <p class="text-center text-muted-foreground py-8 text-sm">Loading comparison data...</p>
  {:else if runIds.length === 0}
    <p class="text-center text-muted-foreground py-8 text-sm">Select runs from the experiment list and click "Compare".</p>
  {:else if availableMetrics.length === 0 && loadedCount >= totalRuns}
    <p class="text-center text-muted-foreground py-8 text-sm">No metrics found for these runs.</p>
  {:else}
    <div class="flex items-center gap-2 mb-3 flex-wrap">
      <!-- Run selector dropdown -->
      <div class="relative" onfocusout={() => setTimeout(() => runMenuOpen = false, 200)}>
        <button class="px-3 py-1 text-xs border border-border rounded-md hover:bg-accent transition-colors" onclick={(e) => { e.stopPropagation(); runMenuOpen = !runMenuOpen; }}>
          Runs ({activeRunIds.length}/{runIds.length})
        </button>
        {#if runMenuOpen}
          <div class="fixed inset-0 z-10" role="presentation" onclick={() => runMenuOpen = false} onkeydown={(e) => { if (e.key === 'Escape') runMenuOpen = false; }}></div>
          <div class="absolute top-full left-0 mt-1 w-56 bg-card border border-border rounded-md shadow-lg z-20 py-1 max-h-72 flex flex-col">
            <div class="px-2 py-1.5 border-b border-border">
              <input type="text" placeholder="Filter runs..." bind:value={runFilter} class="w-full px-2 py-1 text-xs border border-border rounded bg-background" onclick={(e) => e.stopPropagation()} />
            </div>
            <div class="overflow-y-auto flex-1">
              {#each allRunMetrics.filter(r => runFilter ? r.name.toLowerCase().includes(runFilter.toLowerCase()) || r.run_id.toLowerCase().includes(runFilter.toLowerCase()) : true) as rm}
                <label class="flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-accent cursor-pointer">
                  <input type="checkbox" checked={!hiddenRuns.has(rm.run_id)} onchange={() => toggleRun(rm.run_id)} />
                  <span class="font-mono truncate">{rm.name || rm.run_id.slice(0, 12)}</span>
                </label>
              {/each}
            </div>
            <div class="border-t border-border px-3 py-1.5 flex gap-2 text-[10px]">
              <button class="underline text-muted-foreground" onclick={() => hiddenRuns = new Set()}>Show all</button>
            </div>
          </div>
        {/if}
      </div>

      <!-- Metric selector -->
      <MetricPicker
        options={metricOptions}
        value={selectedRefs}
        onValueChange={onMetricsChange}
        formatLabel={(m) => metricLabel(m.key, m.context)}
      />

      <!-- Smoothing control -->
      <div class="flex items-center gap-1.5 text-xs text-muted-foreground ml-2">
        <span>Smooth:</span>
        <button class="px-1.5 py-0.5 rounded hover:bg-accent" onclick={() => smooth = Math.max(0, smooth - 1)}>−</button>
        <span class="min-w-12 text-center">{smooth === 0 ? 'Off' : `win=${smooth * 2 + 1}`}</span>
        <button class="px-1.5 py-0.5 rounded hover:bg-accent" onclick={() => smooth = Math.min(20, smooth + 1)}>+</button>
      </div>

      <!-- Column layout toggle -->
      <div class="flex items-center gap-0.5 border border-border rounded-md overflow-hidden ml-auto">
        <button class="px-2 py-1 text-xs {columns === 1 ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50'}" onclick={() => columns = 1}>1</button>
        <button class="px-2 py-1 text-xs {columns === 2 ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50'}" onclick={() => columns = 2}>2</button>
        <button class="px-2 py-1 text-xs {columns === 3 ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50'}" onclick={() => columns = 3}>3</button>
        <button class="px-2 py-1 text-xs {columns === 4 ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50'}" onclick={() => columns = 4}>4</button>
      </div>
    </div>

    {#if loadedCount < totalRuns}
      <div class="mb-3 text-xs text-muted-foreground flex items-center gap-2">
        <div class="h-1 flex-1 bg-muted rounded overflow-hidden">
          <div class="h-full bg-primary transition-all" style="width: {Math.round(loadedCount / totalRuns * 100)}%"></div>
        </div>
        <span class="shrink-0">Loading {loadedCount}/{totalRuns} runs…</span>
      </div>
    {/if}

    <!-- Charts grid -->
    <div class="grid gap-3" style="grid-template-columns: repeat({columns}, minmax(0, 1fr))">
      {#each chartDataList as cd (cd.key + '|' + cd.context)}
        {#if cd.data.length > 0}
          <div class="border border-border rounded-md overflow-hidden">
            <div class="px-3 py-2 bg-muted/20 border-b border-border text-sm font-medium flex items-center gap-2">
              <ChartLine class="w-4 h-4 inline-block align-text-top" /> {metricLabel(cd.key, cd.context)}
              <span class="text-xs text-muted-foreground font-normal">({cd.data.length} pts)</span>
            </div>
            <div class="px-3 py-1.5 bg-muted/10 border-b border-border text-xs text-muted-foreground flex items-center justify-between">
              <button class="underline hover:text-foreground" onclick={() => xField = xField === 'step' ? 'wall_time' : 'step'}>
                X: {xField === 'step' ? 'Step' : 'Wall Time'}
              </button>
              <span>smooth {smooth === 0 ? 'off' : `win=${smooth * 2 + 1}`}</span>
            </div>
            <div class="p-2">
              <LineChart
                data={cd.data}
                xField="step"
                yField="value"
                xIsTime={xField === 'wall_time'}
                seriesField="series"
                colors={chartColors}
                markers={cd.markers}
                height={280}
                point={false}
              />
            </div>
          </div>
        {/if}
      {/each}
    </div>

    {#if chartDataList.every(cd => cd.data.length === 0) && loadedCount >= totalRuns}
      <p class="text-center text-muted-foreground py-8 text-sm">No data for selected metrics.</p>
    {/if}
  {/if}
</div>

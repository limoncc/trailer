<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import {
    computeAxisScales,
    metricColor,
    buildLinePoints,
    buildChartLayout,
    pointsToPath,
  } from './parallelUtils';

  interface Props {
    data: Record<string, unknown>[];
    dimensions: string[];
    /** Target metric field (e.g. "accuracy__last") for coloring/stats/top combos */
    metricField?: string;
    height?: number;
    title?: string;
  }
  let { data, dimensions, metricField, height = 420, title = 'Parallel Coordinates' }: Props = $props();
  // 平行坐标轴标签多,给足高度
  const chartHeight = $derived(Math.max(height, 420));

  let container: HTMLDivElement;
  let leafer: any = null;
  let contentGroup: any = null;
  let resizeObs: ResizeObserver | null = null;
  let darkObs: MutationObserver | null = null;
  let darkMode = $state(false);
  let hoverRow = $state<Record<string, unknown> | null>(null);
  let activeRow = $state<Record<string, unknown> | null>(null);
  let mousePos = $state<{ x: number; y: number } | null>(null);

  // 高亮目标:悬停优先,否则默认选中
  const highlightRow = $derived(hoverRow ?? activeRow);
  let lineElems: { line: any; row: Record<string, unknown> }[] = [];

  const COLOR_RANGE = ['#3b82f6', '#ef4444']; // blue (low) → red (high)

  function getR(): any {
    return (window as any).__leaferR;
  }
  function axisColor() {
    return darkMode ? '#475569' : '#cbd5e1';
  }
  function textColor() {
    return darkMode ? '#94a3b8' : '#64748b';
  }
  function lineColor() {
    return darkMode ? '#60a5fa' : '#3b82f6';
  }

  function fmtVal(v: number): string {
    if (!Number.isFinite(v)) return '';
    if (v === 0) return '0';
    const a = Math.abs(v);
    if (a >= 1e4 || a < 1e-3) return v.toExponential(2);
    return String(Math.round(v * 1000) / 1000);
  }

  function renderChart() {
    if (!contentGroup || !leafer) return;
    const R = getR();
    if (!R) return;
    while (contentGroup.children?.length > 0) contentGroup.children[0].remove();

    const width = container.clientWidth || 600;
    const layout = buildChartLayout(width, chartHeight, dimensions);
    const scales = computeAxisScales(data, dimensions);
    const ac = axisColor();
    const tc = textColor();

    // 轴 + 刻度值 + 维度名
    for (const axis of layout.axes) {
      contentGroup.add(new R.Path({
        path: `M ${axis.x} ${layout.plotTop} L ${axis.x} ${layout.plotBottom}`,
        stroke: ac, strokeWidth: 1, fill: null,
      }));
      const s = scales[axis.dim] || { min: 0, max: 1 };
      contentGroup.add(new R.Text({ x: axis.x, y: layout.plotTop - 16, text: fmtVal(s.max), fill: tc, fontSize: 9, textAlign: 'center' }));
      contentGroup.add(new R.Text({ x: axis.x, y: layout.plotBottom + 4, text: fmtVal(s.min), fill: tc, fontSize: 9, textAlign: 'center' }));
      // 维度名显示在对应竖轴正上方
      contentGroup.add(new R.Text({ x: axis.x, y: 8, text: axis.dim, fill: tc, fontSize: 10, textAlign: 'center' }));
    }

    if (data.length === 0 || dimensions.length === 0) return;

    // 折线 + 透明 hit 层(悬停/点击)
    const metricScale = metricField ? (computeAxisScales(data, [metricField])[metricField] || null) : null;
    const lc = lineColor();
    lineElems = [];
    for (const row of data) {
      const pts = buildLinePoints(row, dimensions, scales, layout);
      const path = pointsToPath(pts);
      if (!path) continue;
      const color = metricField && metricScale ? metricColor(Number(row[metricField]), metricScale.min, metricScale.max) : lc;
      const line = new R.Path({ path, stroke: color, strokeWidth: 1.2, fill: null, opacity: 0.85 });
      contentGroup.add(line);
      lineElems.push({ line, row });
      // 透明粗 hit 层:细线难以命中,用加宽 stroke 承载指针事件
      const hit = new R.Path({ path, stroke: '#000000', strokeWidth: 14, fill: null, opacity: 0 });
      hit.on(R.PointerEvent.ENTER, () => { hoverRow = row; });
      hit.on(R.PointerEvent.LEAVE, () => { if (hoverRow === row) hoverRow = null; });
      hit.on(R.PointerEvent.TAP, () => { activeRow = row; hoverRow = null; });
      contentGroup.add(hit);
    }
    updateHighlight();
  }

  /** 根据 highlightRow 更新线样式(悬停优先,否则选中);不重建画布 */
  function updateHighlight() {
    const hlId = highlightRow ? String(highlightRow.run_id) : null;
    for (const item of lineElems) {
      const isHl = hlId ? String(item.row.run_id) === hlId : false;
      item.line.opacity = hlId ? (isHl ? 1 : 0.15) : 0.85;
      item.line.strokeWidth = isHl ? 2 : 1.2;
    }
  }

  function updateDark() {
    const isDark = document.documentElement.classList.contains('dark');
    if (isDark !== darkMode) {
      darkMode = isDark;
      renderChart();
    }
  }

  onMount(() => {
    if (!container) return;
    (async () => {
      try {
        const R = await import('leafer-ui');
        (window as any).__leaferR = R;
        darkMode = document.documentElement.classList.contains('dark');
        leafer = new R.Leafer({ view: container });
        const cv = container.querySelector('canvas');
        if (cv) cv.style.background = 'transparent';
        contentGroup = new R.Group();
        leafer.add(contentGroup);
        renderChart();
        if (typeof ResizeObserver !== 'undefined') {
          resizeObs = new ResizeObserver(() => renderChart());
          resizeObs.observe(container);
        }
      } catch (err) {
        console.error('ParallelChart init failed', err);
      }
    })();
    const mo = new MutationObserver(updateDark);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    darkObs = mo;
  });

  onDestroy(() => {
    resizeObs?.disconnect();
    darkObs?.disconnect();
    leafer?.destroy?.();
    leafer = null;
    contentGroup = null;
  });

  // 数据/维度/metric 变化 → 重建
  $effect(() => {
    data;
    dimensions;
    metricField;
    if (leafer) renderChart();
  });

  // 悬停/选中变化 → 只更新线样式(不重建画布,避免闪烁)
  $effect(() => {
    hoverRow;
    activeRow;
    if (leafer && contentGroup) updateHighlight();
  });

  function onMouseMove(e: MouseEvent) {
    const rect = container.getBoundingClientRect();
    mousePos = { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  // Stats over all runs + top combinations(与 G2 版一致)
  const stats = $derived.by(() => {
    if (!metricField) return { count: data.length, avg: null as number | null, max: null as number | null };
    const vals = data.map((r) => Number(r[metricField])).filter((v) => Number.isFinite(v));
    return {
      count: data.length,
      avg: vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null,
      max: vals.length ? Math.max(...vals) : null,
    };
  });
  const topCombos = $derived.by(() => {
    if (!metricField) return [];
    return [...data]
      .filter((r) => Number.isFinite(Number(r[metricField])))
      .sort((a, b) => Number(b[metricField]) - Number(a[metricField]))
      .slice(0, 5);
  });

  // 默认选中排名第 1 的组合(仅首次,用户点击后不再覆盖)
  $effect(() => {
    metricField;
    topCombos;
    if (metricField && topCombos.length > 0 && !activeRow) {
      activeRow = topCombos[0];
    }
  });
</script>

<div class="w-full">
  {#if title}
    <h3 class="text-sm font-semibold mb-2 text-foreground">{title}</h3>
  {/if}

  <div
    role="presentation"
    class="w-full relative"
    style="height: {chartHeight}px;"
    bind:this={container}
    onmousemove={onMouseMove}
  >
    {#if hoverRow && mousePos}
      <div
        class="absolute z-10 pointer-events-none bg-card border border-border rounded-md shadow-lg px-2.5 py-1.5 text-xs max-w-64"
        style="left:{mousePos.x + 14}px; top:{mousePos.y - 10}px;"
      >
        <div class="font-semibold mb-1 truncate">{hoverRow.run_id}</div>
        {#each dimensions as d (d)}
          <div class="flex justify-between gap-4 text-muted-foreground">
            <span class="truncate">{d}</span>
            <span class="tabular-nums">{Number(hoverRow[d]).toFixed(4)}</span>
          </div>
        {/each}
        {#if metricField}
          <div class="flex justify-between gap-4 mt-1 pt-1 border-t border-border" style="color:#ef4444">
            <span class="truncate">{metricField}</span>
            <span class="tabular-nums font-semibold">{Number(hoverRow[metricField]).toFixed(4)}</span>
          </div>
        {/if}
      </div>
    {/if}
  </div>

  <div class="text-xs text-muted-foreground mt-1 flex items-center justify-between flex-wrap gap-2">
    <span>{data.length} runs × {dimensions.length} dims · Hover a line to see its hyperparameters</span>
    {#if metricField}
      <span class="inline-flex items-center gap-1">
        <span class="w-3 h-2 rounded-sm" style="background:linear-gradient(90deg,#3b82f6,#ef4444)"></span>
        Low → High
      </span>
    {/if}
  </div>

  <!-- Stats -->
  {#if metricField}
    <div class="mt-2 grid grid-cols-3 gap-2 text-xs">
      <div class="border border-border rounded-md px-2 py-1.5 bg-card">
        <div class="text-muted-foreground">Runs</div>
        <div class="font-semibold text-sm">{stats.count}</div>
      </div>
      <div class="border border-border rounded-md px-2 py-1.5 bg-card">
        <div class="text-muted-foreground">Avg {metricField}</div>
        <div class="font-semibold text-sm">{stats.avg?.toFixed(4) ?? '—'}</div>
      </div>
      <div class="border border-border rounded-md px-2 py-1.5 bg-card">
        <div class="text-muted-foreground">Max {metricField}</div>
        <div class="font-semibold text-sm">{stats.max?.toFixed(4) ?? '—'}</div>
      </div>
    </div>

    <!-- Top combinations -->
    {#if topCombos.length > 0}
      <div class="mt-2 text-xs">
        <div class="font-semibold mb-1 text-muted-foreground">Top {topCombos.length} Combinations</div>
        <div class="flex flex-col gap-1">
          {#each topCombos as c, i (String(c.run_id) + i)}
            <button
              type="button"
              onclick={() => {
                activeRow = c;
                hoverRow = null;
              }}
              class="flex items-center gap-2 border rounded-md px-2 py-1 bg-card text-left {activeRow?.run_id === c.run_id ? 'border-primary bg-accent/20' : 'border-border hover:bg-accent/40'}"
            >
              <span class="w-4 text-right text-muted-foreground">{i + 1}</span>
              <span class="truncate flex-1">{c.run_id}</span>
              {#each dimensions.slice(0, 4) as d (d)}
                <span class="text-[10px] text-muted-foreground">{d}={Number(c[d]).toFixed(2)}</span>
              {/each}
              <span class="font-semibold ml-auto" style="color:#ef4444">{Number(c[metricField]).toFixed(4)}</span>
            </button>
          {/each}
        </div>
      </div>
    {/if}
  {/if}

  <!-- Guide -->
  <details class="mt-2 text-xs text-muted-foreground">
    <summary class="cursor-pointer hover:text-foreground">Guide</summary>
    <div class="mt-1 leading-relaxed">
      Hover any line to inspect its hyperparameters and target metric. Lines are colored from
      <span style="color:#3b82f6">blue (low)</span> to <span style="color:#ef4444">red (high)</span>.
      Look for the red corridor to spot promising regions; compare adjacent axes to find parameter interactions.
    </div>
  </details>
</div>

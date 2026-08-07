<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { Chart } from '@antv/g2';

  interface DataPoint {
    step: number;
    value: number;
    [key: string]: unknown;
  }

  interface Props {
    data: DataPoint[];
    xField?: string;
    yField?: string;
    xIsTime?: boolean;
    seriesField?: string;
    colors?: string[];
    height?: number;
    smooth?: boolean;
    color?: string;
    lineWidth?: number;
    point?: boolean;
    title?: string;
    /// Log scale on x axis (ignored when xIsTime)
    logX?: boolean;
    /// Log scale on y axis
    logY?: boolean;
    /// Metric name shown in tooltip (e.g. "train/loss")
    metricLabel?: string;
    /// Moving-average window (SMA) applied per series (>1 enables)
    smoothWindow?: number;
    /// Points to highlight on the chart (e.g. latest data point marker)
    markers?: Array<{ step: number; value: number; color?: string }>;
  }

  let {
    data = [],
    xField = 'step',
    yField = 'value',
    xIsTime = false,
    seriesField,
    colors,
    height = 350,
    smooth = false,
    color = '#2563eb',
    lineWidth = 1.5,
    point = false,
    title = '',
    logX = false,
    logY = false,
    metricLabel = '',
    smoothWindow = 0,
    markers = [],
  }: Props = $props();

  let container: HTMLDivElement;
  let chart: Chart | null = null;
  let prevSeriesField: string | undefined;
  let prevXIsTime = false;
  let prevLogX = false;
  let prevLogY = false;
  let prevSmooth = false;
  let prevSmoothWindow = 0;

  /// Custom tick method that only produces integer tick values.
  function integerTick(min: number, max: number, _count: number): number[] {
    const ticks: number[] = [];
    for (let i = Math.ceil(min); i <= Math.floor(max); i++) {
      ticks.push(i);
    }
    return ticks.length > 1 ? ticks : [Math.floor(min), Math.ceil(max)];
  }

  /// Simple moving average per series (window > 1 enables)
  function applySMA(rows: Array<Record<string, unknown>>, window: number): Array<Record<string, unknown>> {
    if (window <= 1 || rows.length === 0) return rows;
    const groups = new Map<string, Array<Record<string, unknown>>>();
    for (const r of rows) {
      const key = seriesField ? String(r[seriesField] ?? '') : '_single';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(r);
    }
    const out: Array<Record<string, unknown>> = [];
    for (const group of groups.values()) {
      group.forEach((r, i) => {
        const start = Math.max(0, i - window + 1);
        const slice = group.slice(start, i + 1);
        const avg = slice.reduce((s, x) => s + Number(x[yField] ?? 0), 0) / slice.length;
        out.push({ ...r, [yField]: avg });
      });
    }
    return out;
  }

  function buildOptions(): Record<string, unknown> {
    // G2 v5 time scale requires Date objects (not numeric timestamps).
    // Convert second/ms timestamps to Date objects so G2 auto-detects time scale.
    let plotData: Array<Record<string, unknown>> = data as unknown as Array<Record<string, unknown>>;
    if (xIsTime && data.length > 0) {
      plotData = data.map(d => {
        const raw = Number(d[xField]);
        const ms = !isNaN(raw) && raw > 0 && raw < 1e11 ? raw * 1000 : raw;
        return { ...d, [xField]: new Date(ms) };
      });
    }
    // 移动平均平滑(按 series 分组)
    if (smoothWindow > 1) {
      plotData = applySMA(plotData, smoothWindow);
    }

    const scaleX: Record<string, unknown> = xIsTime
      ? { nice: false }
      : { nice: false, tickMethod: integerTick, tickCount: 8 };
    const scaleY: Record<string, unknown> = { nice: true };
    if (logX && !xIsTime) scaleX.type = 'log';
    if (logY) scaleY.type = 'log';

    const options: Record<string, unknown> = {
      type: 'line',
      data: plotData,
      encode: {
        x: xField,
        y: yField,
      },
      scale: {
        x: scaleX,
        y: scaleY,
      },
      axis: {
        x: xIsTime ? { title: false, labelFormatter: (d: any) => { const dt = d instanceof Date ? d : new Date(d); return dt.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }); }, labelAutoHide: true, labelAutoRotate: false } : { title: false, labelAutoHide: true, labelAutoRotate: false },
        y: { title: false, labelAutoHide: true, labelAutoRotate: false },
      },
      legend: false,
      tooltip: {
        // x 轴信息显示在 title(多 series 时只显示一次)；items 只列 y(各 series 值)
        title: (d: any) => {
          if (xIsTime) {
            const dt = d[xField] instanceof Date ? d[xField] : new Date(Number(d[xField]));
            return dt.toLocaleString();
          }
          return `${xField}: ${d[xField]}`;
        },
        items: [{ channel: 'y', name: metricLabel || yField, valueFormatter: (v: number) => { const s = String(v); const i = s.indexOf('.'); return i < 0 || s.length - i - 1 <= 6 ? s : v.toFixed(6); } }],
      },
      // crosshair 需配在 interaction.tooltip 而非 tooltip：crosshairsY(竖线)默认开，crosshairsX(水平线)需显式开启
      interaction: {
        tooltip: {
          crosshairsX: true,
          crosshairsY: true,
          crosshairsXStroke: '#94a3b8',
          crosshairsYStroke: '#94a3b8',
        },
      },
      animate: { enter: { type: 'waveIn' } }
    };

    if (seriesField) {
      const palette = colors ?? ['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', '#ec4898', '#06b6d4', '#f97316', '#6366f1', '#14b8a6'];
      options.encode = {
        x: xField,
        y: yField,
        color: seriesField,
      };
      options.type = 'line';
      options.scale = { ...options.scale, color: { range: palette } };
      // lineWidth is safe to set with seriesField (doesn't override color encoding)
      options.style = { lineWidth, ...(smooth ? { shape: 'smooth' } : {}) };
    } else {
      options.style = {
        stroke: color,
        lineWidth,
        ...(smooth ? { shape: 'smooth' } : {}),
      };
    }

    if (point) {
      options.point = {
        size: 3,
        shape: 'point',
      };
    }

    // Add latest-point markers as big green dots (G2 native, no white border)
    if (markers.length > 0) {
      // Markers may be in sec/ms — convert to Date objects to match time axis
      let plotMarkers = markers;
      if (xIsTime && markers.length > 0) {
        plotMarkers = markers.map(m => {
          const raw = Number(m.step);
          const ms = !isNaN(raw) && raw > 0 && raw < 1e11 ? raw * 1000 : raw;
          return { ...m, step: new Date(ms) };
        });
      }
      const lineSpec = { ...options };
      delete lineSpec.animate;
      options.type = 'view';
      options.children = [
        lineSpec,
        {
          type: 'point',
          data: plotMarkers,
          encode: { x: xField, y: yField },
          style: {
            fill: '#22c55e',
            r: 18,
            stroke: null,
            lineWidth: 0,
            cursor: 'pointer',
            opacity: 0.9,
          },
          animate: false,
        },
      ];
    }

    return options;
  }

  let pulseTimer: ReturnType<typeof setInterval> | undefined;
  let resizeObs: ResizeObserver | null = null;

  /** Pulse the marker with dramatic size + color + opacity changes (full rebuild — no slider to reset). */
  function startPulse() {
    stopPulse();
    if (!chart || markers.length === 0) return;
    let toggle = false;
    pulseTimer = setInterval(() => {
      try {
        if (!chart) return;
        toggle = !toggle;
        const opts = buildOptions();
        if (opts.children && opts.children.length > 1) {
          opts.children[1].style = toggle
            ? { fill: '#22c55e', r: 30, stroke: null, lineWidth: 0, opacity: 0.95 }
            : { fill: '#4ade80', r: 14, stroke: null, lineWidth: 0, opacity: 0.6 };
        }
        chart.options(opts);
        chart.render();
      } catch { /* ignore */ }
    }, 600);
  }

  function stopPulse() {
    if (pulseTimer) { clearInterval(pulseTimer); pulseTimer = undefined; }
  }

  function createChart() {
    chart?.destroy();
    chart = new Chart({
      container,
      autoFit: true,
      height,
      animate: true,
    });
    chart.options(buildOptions());
    chart.render();
    prevSeriesField = seriesField;
    prevXIsTime = xIsTime;
    prevLogX = logX;
    prevLogY = logY;
    prevSmooth = smooth;
    prevSmoothWindow = smoothWindow;
    startPulse();
  }

  onMount(() => {
    createChart();
    // 容器尺寸变化(如列数切换)时销毁重建,让 G2 autoFit 重新计算
    if (container && typeof ResizeObserver !== 'undefined') {
      resizeObs = new ResizeObserver(() => createChart());
      resizeObs.observe(container);
    }
  });

  onDestroy(() => {
    resizeObs?.disconnect();
    stopPulse();
    chart?.destroy();
  });

  // Reactive update: recreate chart when seriesField changes, otherwise hot-update
  $effect(() => {
    if (!chart) return;
    // log 轴/平滑等变化需销毁重建,确保 G2 scale 干净切换
    if (
      seriesField !== prevSeriesField ||
      xIsTime !== prevXIsTime ||
      logX !== prevLogX ||
      logY !== prevLogY ||
      smooth !== prevSmooth ||
      smoothWindow !== prevSmoothWindow
    ) {
      createChart();
    } else {
      chart.options(buildOptions());
      chart.render();
      startPulse();
    }
  });
</script>

<div class="w-full">
  {#if title}
    <h3 class="text-sm font-semibold mb-2 text-foreground">{title}</h3>
  {/if}
  <div bind:this={container} class="w-full" style="height: {height}px;"></div>
</div>

<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { Chart } from '@antv/g2';

  interface DataPoint {
    x: number;
    y: number;
    category?: string;
    [key: string]: unknown;
  }

  interface Props {
    data: DataPoint[];
    xField?: string;
    yField?: string;
    colorField?: string;
    height?: number;
    title?: string;
    pointSize?: number;
    /// Log scale on x axis
    logX?: boolean;
    /// Log scale on y axis
    logY?: boolean;
    /// Draw a linear regression line (least squares)
    regression?: boolean;
  }

  let {
    data = [],
    xField = 'x',
    yField = 'y',
    colorField,
    height = 350,
    title = '',
    pointSize = 4,
    logX = false,
    logY = false,
    regression = false,
  }: Props = $props();

  let container: HTMLDivElement;
  let chart: Chart | null = null;

  // 手写 DOM crosshair overlay：G2 5.4.8 的 point mark 原生不支持 crosshair(已知 issue)，用 overlay 精确对齐绘图区
  let plotBox: HTMLDivElement;
  let hline: HTMLDivElement;
  let vline: HTMLDivElement;
  let plotLeft = $state(0);
  let plotTop = $state(0);
  let plotW = $state(0);
  let plotH = $state(0);
  let crosshairCleanup: () => void = () => {};

  function linearFit(pts: Array<{ x: number; y: number }>) {
    const n = pts.length;
    if (n < 2) return null;
    let sx = 0, sy = 0, sxy = 0, sxx = 0;
    for (const p of pts) {
      sx += p.x;
      sy += p.y;
      sxy += p.x * p.y;
      sxx += p.x * p.x;
    }
    const denom = n * sxx - sx * sx;
    if (Math.abs(denom) < 1e-12) return null;
    const a = (n * sxy - sx * sy) / denom;
    const b = (sy - a * sx) / n;
    return { a, b };
  }

  function buildOptions() {
    const scaleX: Record<string, unknown> = { nice: true };
    const scaleY: Record<string, unknown> = { nice: true };
    if (logX) scaleX.type = 'log';
    if (logY) scaleY.type = 'log';

    const pointSpec: Record<string, unknown> = {
      type: 'point',
      encode: {
        x: xField,
        y: yField,
        shape: "point"
      },
      scale: {
        x: scaleX,
        y: scaleY,
      },
      axis: {
        x: { title: xField, labelAutoHide: true, labelAutoRotate: false },
        y: { title: yField, labelAutoHide: true, labelAutoRotate: false },
      },
      legend: { color: { position: 'bottom', layout: {justifyContent: 'center' } },
      tooltip: {
        items: [
          { channel: 'x', name: xField },
          { channel: 'y', name: yField },
        ],
      },
      style: {
        // size: pointSize,
        lineWidth: 0,
        fill: '#2563eb',
        fillOpacity: 0.3,
      },
    }};

    if (colorField) {
      (pointSpec.encode as Record<string, unknown>).color = colorField;
    }

    if (regression) {
      const pts = data
        .map((d) => ({ x: Number(d[xField]), y: Number(d[yField]) }))
        .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
      const fit = linearFit(pts);
      if (fit && pts.length >= 2) {
        const xs = pts.map((p) => p.x);
        const minX = Math.min(...xs);
        const maxX = Math.max(...xs);
        // 拟合公式文本(工具提示显示)
        const formula = `y = ${fit.a.toFixed(4)}x ${fit.b >= 0 ? '+' : '-'} ${Math.abs(fit.b).toFixed(4)}`;
        // G2 v5 多 mark 叠加须用 view + children;回归线用拟合数据画 line mark
        return {
          type: 'view',
          data,
          children: [
            pointSpec,
            {
              type: 'line',
              data: [
                { x: minX, y: fit.a * minX + fit.b },
                { x: maxX, y: fit.a * maxX + fit.b },
              ],
              encode: { x: 'x', y: 'y' },
              style: { stroke: '#ef4444', lineWidth: 1.5, strokeDasharray: '4 4', strokeOpacity: 0.8 },
              tooltip: {
                title: () => `Regression: ${formula}`,
                items: [
                  { field: 'x', name: xField },
                  { field: 'y', name: yField },
                ],
              },
            },
          ],
        };
      }
    }

    return { type: 'point', data, ...pointSpec };
  }

  let resizeObs: ResizeObserver | null = null;

  function renderChart() {
    if (!chart) return;
    chart.options(buildOptions());
    chart.render();
  }

  function createChart() {
    chart?.destroy();
    chart = new Chart({
      container,
      autoFit: true,
      height,
    });
    renderChart();
    updatePlotBox();
  }

  /// 用 G2 coordinate 计算绘图区在容器内的位置(margin/padding/inset 累加)。
  function updatePlotBox() {
    if (!chart) return;
    try {
      const o = chart.getCoordinate().getOptions() as Record<string, number>;
      plotLeft = (o.marginLeft || 0) + (o.paddingLeft || 0) + (o.insetLeft || 0);
      plotTop = (o.marginTop || 0) + (o.paddingTop || 0) + (o.insetTop || 0);
      plotW = o.innerWidth || 0;
      plotH = o.innerHeight || 0;
    } catch { /* coordinate 未就绪时保持默认 */ }
  }

  function setupCrosshair() {
    if (!container || !plotBox || !hline || !vline) return;
    const onMove = (e: PointerEvent) => {
      const rect = container.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      // 仅在绘图区内显示十字线，避免延伸到轴标签区域
      if (x < plotLeft || x > plotLeft + plotW || y < plotTop || y > plotTop + plotH) {
        plotBox.classList.add('hidden');
        return;
      }
      plotBox.classList.remove('hidden');
      hline.style.display = 'block';
      vline.style.display = 'block';
      hline.style.top = `${y - plotTop}px`;
      vline.style.left = `${x - plotLeft}px`;
    };
    const onLeave = () => {
      plotBox.classList.add('hidden');
      hline.style.display = 'none';
      vline.style.display = 'none';
    };
    container.addEventListener('pointermove', onMove);
    container.addEventListener('pointerleave', onLeave);
    crosshairCleanup = () => {
      container.removeEventListener('pointermove', onMove);
      container.removeEventListener('pointerleave', onLeave);
    };
  }

  onMount(() => {
    createChart();
    setupCrosshair();
    // 容器尺寸变化(如列数切换)时销毁重建,让 G2 autoFit 重新计算
    if (container && typeof ResizeObserver !== 'undefined') {
      resizeObs = new ResizeObserver(() => createChart());
      resizeObs.observe(container);
    }
  });

  onDestroy(() => {
    crosshairCleanup();
    resizeObs?.disconnect();
    chart?.destroy();
  });

  $effect(() => {
    if (chart) {
      renderChart();
    }
  });
</script>

<div class="w-full">
  {#if title}
    <h3 class="text-sm font-semibold mb-2 text-foreground">{title}</h3>
  {/if}
  <div class="relative" style="height: {height}px;">
    <div bind:this={container} class="w-full h-full"></div>
    <!-- 手写 crosshair：仅覆盖 G2 绘图区，横竖线跟随鼠标 -->
    <div
      bind:this={plotBox}
      class="pointer-events-none absolute hidden"
      style="left: {plotLeft}px; top: {plotTop}px; width: {plotW}px; height: {plotH}px;"
    >
      <div bind:this={hline} class="absolute left-0 right-0 border-t border-foreground/40" style="display:none;"></div>
      <div bind:this={vline} class="absolute top-0 bottom-0 border-l border-foreground/40" style="display:none;"></div>
    </div>
  </div>
</div>

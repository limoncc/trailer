<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { Chart } from '@antv/g2';
  import { colormap, type ParsedLandscape } from './landscape';

  interface Props {
    data: ParsedLandscape | null;
    height?: number;
    /** 等值线阈值（数据空间）；非空时叠加等高线（依赖 Step 5 的 buildContourRings 数据） */
    contourLevels?: number[];
    /** 等高线折线数据：每条闭合环一个 id + 有序点列（index 空间已映射回数据空间） */
    contourRings?: { id: number; points: [number, number][] }[];
  }

  let { data, height = 420, contourLevels = [], contourRings = [] }: Props = $props();

  let container: HTMLDivElement;
  let chart: Chart | null = null;
  let showContours = $derived(contourLevels.length > 0 && contourRings.length > 0);

  // viridis 9 档采样 → G2 线性色标 range
  const COLOR_RANGE = Array.from({ length: 9 }, (_, i) => {
    const [r, g, b] = colormap(i / 8);
    return `rgb(${r},${g},${b})`;
  });

  /** 网格 → rect 长表：每个格子 x1/x2/y1/y2 为中心 ± 半步长（含端点等距网格）。 */
  function buildCells(d: ParsedLandscape) {
    const dx = d.xs.length > 1 ? (d.xs[d.xs.length - 1] - d.xs[0]) / (2 * (d.xs.length - 1)) : 0.5;
    const dy = d.ys.length > 1 ? (d.ys[d.ys.length - 1] - d.ys[0]) / (2 * (d.ys.length - 1)) : 0.5;
    const cells: { x1: number; x2: number; y1: number; y2: number; v: number; a: number; b: number }[] = [];
    for (let r = 0; r < d.nRows; r++) {
      for (let c = 0; c < d.nCols; c++) {
        const a = d.xs[c];
        const b = d.ys[r];
        cells.push({ x1: a - dx, x2: a + dx, y1: b - dy, y2: b + dy, v: d.z[r * d.nCols + c], a, b });
      }
    }
    return cells;
  }

  function buildOptions(d: ParsedLandscape) {
    const children: Record<string, unknown>[] = [
      {
        type: 'rect',
        data: buildCells(d),
        encode: { x: 'x1', x1: 'x2', y: 'y1', y1: 'y2', color: 'v' },
        style: { stroke: 'none' },
        scale: { color: { type: 'linear', domain: [d.zmin, d.zmax], range: COLOR_RANGE } },
        tooltip: {
          items: [
            { field: 'a', name: 'α' },
            { field: 'b', name: 'β' },
            { field: 'v', name: 'loss' },
          ],
        },
      },
    ];
    if (showContours) {
      const lines: { x: number; y: number; id: number }[] = [];
      for (const ring of contourRings) {
        for (const [x, y] of ring.points) lines.push({ x, y, id: ring.id });
        // 闭合环：补回首点
        if (ring.points.length > 1) {
          const [fx, fy] = ring.points[0];
          lines.push({ x: fx, y: fy, id: ring.id });
        }
      }
      children.push({
        type: 'line',
        data: lines,
        encode: { x: 'x', y: 'y', series: 'id' },
        style: { stroke: 'rgba(15,23,42,0.55)', lineWidth: 1 },
        tooltip: false,
        animate: false,
      });
    }
    return {
      type: 'view',
      scale: {
        x: { domain: [d.xRange[0], d.xRange[1]] },
        y: { domain: [d.yRange[0], d.yRange[1]] },
      },
      axis: {
        x: { title: 'α (direction 1)' },
        y: { title: 'β (direction 2)' },
      },
      legend: false,
      children,
    };
  }

  function render() {
    if (!chart || !data) return;
    chart.options(buildOptions(data));
    chart.render();
  }

  onMount(() => {
    chart = new Chart({ container, autoFit: true, height });
    render();
  });

  onDestroy(() => {
    chart?.destroy();
    chart = null;
  });

  // data / 等高线开关变化 → 重渲染（不重建 Chart 实例）
  $effect(() => {
    void data;
    void showContours;
    render();
  });
</script>

<div class="w-full">
  <div bind:this={container} class="w-full" style="height: {height}px;"></div>
  {#if !data}
    <div class="flex h-40 items-center justify-center text-xs text-muted-foreground">No landscape data</div>
  {/if}
</div>

<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { Chart } from '@antv/g2';

  interface HeatmapDataPoint {
    x: string;
    y: string;
    value: number;
    [key: string]: unknown;
  }

  interface Props {
    data: HeatmapDataPoint[];
    xField?: string;
    yField?: string;
    colorField?: string;
    height?: number;
    title?: string;
    colorScale?: [string, string];
  }

  let {
    data = [],
    xField = 'x',
    yField = 'y',
    colorField = 'value',
    height = 400,
    title = 'Confusion Matrix',
    colorScale = ['#f0f9ff', '#2563eb'] as [string, string],
  }: Props = $props();

  let container: HTMLDivElement;
  let chart: Chart | null = null;

  function buildOptions() {
    const options: Record<string, unknown> = {
      type: 'cell',
      data,
      encode: {
        x: xField,
        y: yField,
        color: colorField,
      },
      scale: {
        color: {
          type: 'linear',
          range: colorScale,
        },
      },
      style: {
        stroke: '#fff',
        lineWidth: 2,
      },
      tooltip: {
        title: '',
        items: [
          { field: xField, name: 'Predicted' },
          { field: yField, name: 'Actual' },
          { field: colorField, name: 'Count' },
        ],
      },
      axis: {
        x: { title: 'Predicted' },
        y: { title: 'Actual' },
      },
      label: {
        text: colorField,
        style: {
          fill: '#fff',
          fontWeight: 'bold' as const,
          fontSize: 12,
        },
      },
    };
    return options;
  }

  function renderChart() {
    if (!chart) return;
    chart.options(buildOptions());
    chart.render();
  }

  onMount(() => {
    chart = new Chart({
      container,
      autoFit: true,
      height,
    });
    renderChart();
  });

  onDestroy(() => {
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
  <div bind:this={container} class="w-full" style="height: {height}px;"></div>
</div>

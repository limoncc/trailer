<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { Chart } from '@antv/g2';

  interface Props {
    spec: Record<string, unknown>;
    height?: number;
  }

  let { spec, height = 300 }: Props = $props();

  let container: HTMLDivElement;
  let chart: Chart | null = null;

  function renderChart() {
    if (!chart) return;
    chart.options(spec);
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
    if (chart) renderChart();
  });
</script>

<div bind:this={container} class="w-full" style="height: {height}px;"></div>

<script lang="ts">
  import LineChart from './LineChart.svelte';
  import ScatterChart from './ScatterChart.svelte';
  import ParallelChart from './ParallelChart.svelte';
  import type { ChartDef } from '$lib/utils/explore';

  interface Props {
    def: ChartDef;
    rows: Array<Record<string, unknown>>;
    colorField: string;
    dimensions?: string[];
    metricField?: string;
    height?: number;
  }
  let { def, rows, colorField, dimensions = [], metricField, height = 320 }: Props = $props();
</script>

{#if def.type === 'line'}
  <LineChart
    data={rows as Array<{ step: number; value: number; [k: string]: unknown }>}
    xField={def.x.kind === 'wall_time' ? 'wall_time' : 'step'}
    yField="value"
    seriesField={colorField}
    xIsTime={def.x.kind === 'wall_time'}
    logX={def.xLog}
    logY={def.yLog}
    smooth={def.smooth}
    smoothWindow={def.smoothWindow}
    metricLabel={def.metrics.map((m) => (m.context ? `${m.context}/${m.key}` : m.key)).join(', ')}
    {height}
  />
{:else if def.type === 'scatter' || def.type === 'scatter-pair'}
  <ScatterChart
    data={rows as Array<{ x: number; y: number; [k: string]: unknown }>}
    xField="x"
    yField="y"
    colorField={colorField}
    logX={def.type === 'scatter' ? def.xLog : undefined}
    logY={def.type === 'scatter' ? def.yLog : undefined}
    regression={def.type === 'scatter' ? def.regression : false}
    {height}
  />
{:else if def.type === 'parallel'}
  <ParallelChart data={rows} dimensions={dimensions} {metricField} {height} title="Parallel" />
{/if}

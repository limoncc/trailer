<script lang="ts">
  import LineChart from './LineChart.svelte';

  interface DataPoint {
    step: number;
    value: number;
    runId?: string;
    key?: string;
    context?: string;
    [key: string]: unknown;
  }

  interface Props {
    data: DataPoint[];
    xField?: string;
    yField?: string;
    seriesField?: string;
    colors?: string[];
    height?: number;
    smooth?: boolean;
    point?: boolean;
    title?: string;
    /// Green pulsing markers for running experiments
    markers?: Array<{ step: number; value: number }>;
  }

  let {
    data = [],
    xField = 'step',
    yField = 'value',
    seriesField = 'runId',
    colors,
    height = 300,
    smooth = false,
    point = false,
    title = '',
    markers = [],
  }: Props = $props();
</script>

<LineChart
  {data}
  {xField}
  {yField}
  {seriesField}
  {colors}
  {height}
  {smooth}
  {point}
  {title}
  {markers}
/>



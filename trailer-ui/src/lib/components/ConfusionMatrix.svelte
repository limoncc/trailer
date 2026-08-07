<script lang="ts">
  import { onMount } from 'svelte';
  import { Chart } from '@antv/g2';

  interface Props {
    matrix: number[][];
    labels?: string[];
    title?: string;
  }

  let { matrix, labels = [], title = "Confusion Matrix" }: Props = $props();
  let container: HTMLDivElement;
  let chart: Chart | null = null;

  function render() {
    if (!container || !matrix.length) return;

    if (chart) chart.destroy();
    const h = container.clientHeight || 400;
    chart = new Chart({ container, height: h, theme: document.documentElement.classList.contains('dark') ? 'dark' : 'light' });

    // Flatten matrix into data records
    const data: { x: string; y: string; value: number }[] = [];
    const n = matrix.length;
    const maxVal = Math.max(...matrix.flat(), 1);
    const labs = labels.length === n ? labels : Array.from({length: n}, (_, i) => labels[i] || `${i}`);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < (matrix[i]?.length || n); j++) {
        data.push({ x: labs[j], y: labs[i], value: matrix[i][j] });
      }
    }

    chart.cell().data(data).encode('x', 'x').encode('y', 'y').encode('color', 'value')
      .scale('color', { palette: 'blues', domain: [0, maxVal] })
      .label({ text: 'value', style: { fontSize: 12, fill: (d: any) => d.value > maxVal * 0.5 ? '#fff' : '#333' } });

    chart.axis('x', { title: 'Predicted' });
    chart.axis('y', { title: 'True' });
    chart.legend('color', { title: 'Count' });

    chart.render();
  }

  onMount(() => { render(); });

  $effect(() => {
    matrix; labels; // reactivity triggers
    render();
  });
</script>

<div bind:this={container} class="w-full h-80"></div>

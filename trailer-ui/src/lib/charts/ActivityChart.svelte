<script lang="ts">
  interface Props {
    data: Record<string, number>;
  }

  let { data }: Props = $props();
  let tooltip = $state<{ x: number; y: number; text: string } | null>(null);
  let chartEl = $state<HTMLDivElement | null>(null);
  let cellSize = $state(8);

  const GAP = 2;
  let STEP = $derived(cellSize + GAP);

  function measure() {
    if (!chartEl) return;
    const w = chartEl.offsetWidth - 28;
    const maxCell = Math.max(3, Math.floor((w - 52 * GAP) / 53));
    // 提高上限,让大屏下网格填满容器宽度,避免右侧大片空白
    cellSize = Math.min(16, maxCell);
  }

  $effect(() => {
    if (chartEl) {
      measure();
      const ro = new ResizeObserver(measure);
      ro.observe(chartEl);
      return () => ro.disconnect();
    }
  });
  const COLS = 53;

  // GitHub-style palette
  const colors = ['#ebedf0', '#9be9a8', '#40c463', '#30a14e', '#216e39'];

  // Build grid: cols[week][day] where day 0 = Monday
  let grid = $derived.by(() => {
    const today = new Date();
    const end = new Date(today);
    end.setDate(end.getDate() - ((end.getDay() + 6) % 7 + 1)); // last Saturday
    const start = new Date(end);
    start.setDate(start.getDate() - (COLS - 1) * 7);

    const cols: { date: string; count: number; level: number }[][] = [];
    const d = new Date(start);
    while (d <= end) {
      const col: { date: string; count: number; level: number }[] = [];
      for (let i = 0; i < 7; i++) {
        const key = d.toISOString().slice(0, 10);
        const count = data[key] || 0;
        col.push({ date: key, count, level: count === 0 ? 0 : count <= 1 ? 1 : count <= 3 ? 2 : count <= 6 ? 3 : 4 });
        d.setDate(d.getDate() + 1);
      }
      cols.push(col);
    }
    return cols;
  });

  // Month label positions
  let months = $derived.by(() => {
    const ms: { label: string; x: number }[] = [];
    let last = -1;
    const names = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    for (let c = 0; c < grid.length; c++) {
      const m = new Date(grid[c][0].date).getMonth();
      if (m !== last) { last = m; ms.push({ label: names[m], x: c * STEP }); }
    }
    return ms;
  });

  const DAYS = ['', 'Mon', '', 'Wed', '', 'Fri', ''];
  let W = $derived(grid.length * STEP);
  let H = $derived(7 * STEP);
</script>

<div bind:this={chartEl} style="overflow:hidden;padding:4px 0 4px 32px">
  <div style="position:relative;width:{W}px;height:{H + 16}px;margin:0 auto">
    <!-- Month labels -->
    {#each months as m}
      <span style="position:absolute;left:{m.x}px;top:0;font-size:9px;color:#898781">{m.label}</span>
    {/each}

    <!-- Day labels -->
    {#each DAYS as label, i}
      {#if label}
        <span style="position:absolute;left:-28px;top:{i * STEP + 14}px;font-size:9px;color:#898781;width:24px;text-align:right">{label}</span>
      {/if}
    {/each}

    <!-- Cells -->
    {#each grid as col, ci}
      {#each col as day, ri}
        <div
          role="gridcell" tabindex="0"
          style="position:absolute;left:{ci * STEP}px;top:{ri * STEP + 14}px;width:{cellSize}px;height:{cellSize}px;border-radius:2px;background:{colors[day.level]};cursor:pointer"
          onmouseenter={(e) => { e.currentTarget.style.outline = '1.5px solid #57606a'; tooltip = { x: e.clientX, y: e.clientY, text: `${day.date}: ${day.count} run${day.count !== 1 ? 's' : ''}` }; }}
          onmousemove={(e) => { tooltip = { x: e.clientX, y: e.clientY, text: tooltip?.text || '' }; }}
          onmouseleave={(e) => { e.currentTarget.style.outline = 'none'; tooltip = null; }}
        ></div>
      {/each}
    {/each}
  </div>

  <!-- Floating tooltip -->
  {#if tooltip}
    <div style="position:fixed;left:{tooltip.x + 12}px;top:{tooltip.y - 30}px;background:#24292f;color:#fff;padding:3px 8px;border-radius:4px;font-size:11px;white-space:nowrap;z-index:999;pointer-events:none;box-shadow:0 1px 4px rgba(0,0,0,0.15)">
      {tooltip.text}
    </div>
  {/if}

  <!-- Legend -->
  <div style="display:flex;align-items:center;gap:3px;margin-top:4px;font-size:9px;color:#898781;justify-content:flex-end">
    <span>Less</span>
    {#each colors as c}
      <span style="display:inline-block;width:{cellSize}px;height:{cellSize}px;border-radius:2px;background:{c}"></span>
    {/each}
    <span>More</span>
  </div>
</div>

<script lang="ts">
  // ─── Explore 对比看板:装配 ExploreCtx/展平指标 + 网格接线 + 配置编辑器挂载 ───
  // state 全在 ExploreWorkspace(唯一持有者);本组件只做 $derived 装配与回调上抛。
  import DashboardGrid from './boards/DashboardGrid.svelte';
  import ExploreWidgetEditor from './ExploreWidgetEditor.svelte';
  import { EMPTY_BOARDS_DATA, type MetricSeries } from './boards/boardsData';
  import { colorValueOf, PALETTE, type ExploreCtx } from '$lib/utils/exploreWidgets';
  import type { DashWidget } from '$lib/utils/dashboard';
  import type { RunRecord, SeriesData } from '$lib/utils/explore';

  interface Props {
    widgets: DashWidget[];
    /** 可见(未隐藏)的选中 run,稳定顺序 */
    runs: RunRecord[];
    series: SeriesData;
    /** run_id → state('running' / 'finished' / …),轮询刷新 */
    runStates: Map<string, string>;
    /** 稳定配色表(Workspace 维护,显隐不换色) */
    colors: Map<string, string>;
    /** readOnly = false 时可拖拽/编辑 */
    editing: boolean;
    onChange: (widgets: DashWidget[]) => void;
  }
  let { widgets, runs, series, runStates, colors, editing, onChange }: Props = $props();

  /** series → WidgetContent 的展平指标(带 run_id),按 runs 顺序保证 first-appearance 稳定 */
  const flatMetrics = $derived.by((): MetricSeries[] => {
    const out: MetricSeries[] = [];
    for (const r of runs) {
      for (const g of series.get(r.run_id) ?? []) {
        out.push({ key: g.key, context: g.context, points: g.points, run_id: r.run_id });
      }
    }
    return out;
  });

  const explore = $derived<ExploreCtx>({
    runs,
    labelOf: (runId) => {
      const r = runs.find((x) => x.run_id === runId);
      return r?.name ?? runId.slice(0, 12);
    },
    colorValueOf,
    colorOfValue: (cv) => colors.get(cv) ?? PALETTE[0],
    isRunning: (runId) => runStates.get(runId) === 'running',
    series,
  });

  // ─── 配置编辑器(条件挂载:每次打开都是新实例) ───
  let editingWidget = $state<DashWidget | null>(null);
  function confirmEdit(next: DashWidget) {
    onChange(widgets.map((w) => (w.id === next.id ? next : w)));
    editingWidget = null;
  }
</script>

{#if widgets.length === 0}
  <div class="border border-dashed rounded-md p-10 text-center text-sm text-muted-foreground">
    {editing ? 'Select runs, then use “Add Widget” to start comparing.' : 'This analysis has no widgets.'}
  </div>
{:else}
  <DashboardGrid
    {widgets}
    {editing}
    runId=""
    metrics={flatMetrics}
    boardsData={EMPTY_BOARDS_DATA}
    {explore}
    {onChange}
    onEditContent={(w) => (editingWidget = w)}
  />
{/if}

{#if editingWidget}
  <ExploreWidgetEditor widget={editingWidget} {runs} onConfirm={confirmEdit} onClose={() => (editingWidget = null)} />
{/if}

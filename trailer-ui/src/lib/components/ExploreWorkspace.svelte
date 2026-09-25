<script lang="ts">
  // ─── Explore 分析工作区:看板化后的唯一 state 持有者 ───
  // 持有 title / 选中与隐藏 run / widgets / series 缓存 / run 状态 / 稳定配色,
  // 负责加载、保存与回调驱动的刷新;渲染全部交给 ExploreBoard(DashboardGrid 复用)。
  import { onMount } from 'svelte';
  import RunPicker from '$lib/components/RunPicker.svelte';
  import ExploreBoard from '$lib/components/ExploreBoard.svelte';
  import { api } from '$lib/utils/api';
  import type { MetricRef, RunRecord, SeriesData } from '$lib/utils/explore';
  import { loadSeries, parseSummaryKey } from '$lib/utils/explore';
  import type { DashWidget } from '$lib/utils/dashboard';
  import { defaultSize, newWidgetId, serializeLayout } from '$lib/utils/dashboard';
  import { assignStableColors, colorValueOf } from '$lib/utils/exploreWidgets';

  interface Props {
    initialRunIds?: string[];
    /** 已保存的看板 layout(由路由解析 e.config 得到);空 = 空看板 */
    initialWidgets?: DashWidget[];
    initialTitle?: string;
    savedId?: string | null;
    readOnly?: boolean;
    onSaved?: (id: string) => void;
    onShare?: () => void;
  }
  let {
    initialRunIds = [],
    initialWidgets = [],
    initialTitle = 'Untitled analysis',
    savedId = null,
    readOnly = false,
    onSaved,
    onShare,
  }: Props = $props();

  let runs: RunRecord[] = $state([]);
  // svelte-ignore state_referenced_locally
  let selectedRuns = $state<Set<string>>(new Set(initialRunIds));
  /** 会话态隐藏的 run(不入库,仅当前视图剔除) */
  let hiddenRuns = $state<Set<string>>(new Set());
  let series: SeriesData = $state(new Map());
  // svelte-ignore state_referenced_locally
  let widgets: DashWidget[] = $state(initialWidgets);
  let runStates = $state<Map<string, string>>(new Map());
  /** 稳定配色表:只增不减(显隐/排序不换色),在事件回调里累积 */
  let colors = $state<Map<string, string>>(new Map());
  let loading = $state(true);
  // svelte-ignore state_referenced_locally
  let title = $state(initialTitle);
  let saving = $state(false);
  let saveMsg = $state<{ text: string; ok: boolean } | null>(null);
  let msgTimer: ReturnType<typeof setTimeout> | undefined;

  /** 可见 run = 选中(保持选中顺序)且未被隐藏 */
  const visibleRuns = $derived(runs.filter((r) => selectedRuns.has(r.run_id) && !hiddenRuns.has(r.run_id)));

  /** 卡片需要的指标:line 的 metrics + scatter-pair 的 x/y */
  function collectNeededMetrics(ws: DashWidget[]): MetricRef[] {
    const out: MetricRef[] = [];
    for (const w of ws) {
      if (w.type === 'line') out.push(...w.metrics);
      else if (w.type === 'scatter-pair') {
        out.push(w.x);
        out.push(w.y);
      }
    }
    return out;
  }

  /** 默认图表指标:选中 run 的第一个 summary 指标(保证有数据,而非硬编码 loss/'') */
  function pickDefaultMetric(): MetricRef {
    const rec = visibleRuns[0];
    const k = rec?.summary ? Object.keys(rec.summary)[0] : null;
    return k ? parseSummaryKey(k) : { key: 'loss', context: '' };
  }

  function hasMetric(m: MetricRef): boolean {
    return visibleRuns.some((r) =>
      Object.keys(r.summary || {}).some((k) => {
        const { key, context } = parseSummaryKey(k);
        return key === m.key && context === m.context;
      })
    );
  }

  /** 把当前需要的色值补进配色表(事件回调中调用,只增不减) */
  function syncColors() {
    const keys: string[] = [...selectedRuns];
    for (const w of widgets) {
      const cb =
        w.type === 'line' || w.type === 'scatter' || w.type === 'scatter-pair' || w.type === 'parallel'
          ? w.colorBy
          : undefined;
      if (!cb || cb.kind === 'run') continue;
      for (const r of runs) keys.push(colorValueOf(r, cb));
    }
    colors = assignStableColors(colors, keys);
  }

  async function refreshSeries() {
    // 默认(context='')且可见 run 无该指标的 line 图,自动替换为实际存在的指标
    if (visibleRuns.length > 0) {
      const fallback = pickDefaultMetric();
      widgets = widgets.map((w) => {
        if (w.type !== 'line') return w;
        return { ...w, metrics: w.metrics.map((m) => (m.context === '' && !hasMetric(m) ? fallback : m)) };
      });
    }
    await loadSeries(series, visibleRuns, collectNeededMetrics(widgets), 500);
    series = new Map(series);
    syncColors();
  }

  async function load() {
    loading = true;
    const resp = await api('/api/v1/runs?limit=1000');
    if (resp.ok) {
      runs = await resp.json();
      runStates = new Map(runs.map((r) => [r.run_id, r.state]));
    }
    // 旧分析(无 config.layout)打开为空看板——不做历史迁移
    syncColors();
    await refreshSeries();
    loading = false;
  }

  onMount(load);

  function toggleSelect(runId: string, checked: boolean) {
    const next = new Set(selectedRuns);
    if (checked) next.add(runId);
    else next.delete(runId);
    selectedRuns = next;
    refreshSeries();
  }

  function clearSelection() {
    selectedRuns = new Set();
    refreshSeries();
  }

  function addWidget() {
    const size = defaultSize('line');
    widgets = [
      ...widgets,
      {
        id: newWidgetId(),
        type: 'line',
        metrics: [pickDefaultMetric()],
        xKind: 'step',
        w: size.w,
        h: size.h,
      },
    ];
    refreshSeries();
  }

  /** 拖拽/缩放/改题/编辑内容等全部布局变更(回调驱动,不放 effect) */
  function updateWidgets(next: DashWidget[]) {
    widgets = next;
    refreshSeries();
  }

  async function save() {
    saving = true;
    saveMsg = null;
    clearTimeout(msgTimer);
    const body = {
      title,
      description: '',
      run_ids: JSON.stringify([...selectedRuns]),
      config: JSON.stringify({ layout: serializeLayout({ version: 3, widgets }) }),
    };
    const url = savedId ? `/api/v1/explores/${savedId}` : '/api/v1/explores';
    try {
      const resp = await api(url, {
        method: savedId ? 'PUT' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (resp.ok) {
        const data = await resp.json();
        onSaved?.(data.id as string);
        saveMsg = { text: savedId ? '✓ Saved' : '✓ Created', ok: true };
      } else {
        saveMsg = { text: `Save failed (HTTP ${resp.status})`, ok: false };
      }
    } catch (e) {
      saveMsg = { text: `Save failed: ${e instanceof Error ? e.message : String(e)}`, ok: false };
    } finally {
      saving = false;
      msgTimer = setTimeout(() => (saveMsg = null), 3000);
    }
  }
</script>

<div class="flex flex-col h-full">
  <!-- 工具栏 -->
  <div class="flex items-center gap-2 px-3 py-2 border-b border-border">
    {#if readOnly}
      <span class="text-sm font-semibold">{title}</span>
      <span class="text-xs text-muted-foreground ml-1">{selectedRuns.size} runs · {widgets.length} charts</span>
    {:else}
      <input
        bind:value={title}
        class="text-sm font-medium w-56 px-2 py-1 border border-border rounded-md bg-background"
        placeholder="Analysis title"
      />
      <RunPicker {runs} selected={selectedRuns} onselect={toggleSelect} onclear={clearSelection} />
      <span class="text-xs text-muted-foreground hidden sm:inline shrink-0">
        {selectedRuns.size} runs selected
      </span>
    {/if}
    <div class="ml-auto flex items-center gap-1.5 shrink-0">
      {#if onShare && savedId && !readOnly}
        <button
          type="button"
          onclick={onShare}
          class="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs border border-border rounded-md hover:bg-accent/50 transition-colors"
        >
          <svg class="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.59 13.51 6.83 3.98"/><path d="m15.41 6.51-6.82 3.98"/></svg>
          Share
        </button>
      {/if}
      {#if !readOnly}
        <button
          type="button"
          onclick={addWidget}
          class="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs border border-border rounded-md hover:bg-accent/50 transition-colors"
        >
          <svg class="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14"/><path d="M12 5v14"/></svg>
          Add Widget
        </button>
        <button
          type="button"
          onclick={save}
          disabled={saving}
          class="inline-flex items-center gap-1 px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded-md hover:opacity-90 transition-opacity disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Save'}
        </button>
        {#if saveMsg}
          <span class="text-xs {saveMsg.ok ? 'text-green-600' : 'text-destructive'}" aria-live="polite">
            {saveMsg.text}
          </span>
        {/if}
      {/if}
    </div>
  </div>

  <!-- 看板区(36 列网格,拖拽/缩放/吸附同 Boards) -->
  <div class="flex-1 p-3 overflow-y-auto">
    {#if loading}
      <p class="text-center text-muted-foreground py-10 text-sm">Loading...</p>
    {:else}
      <ExploreBoard
        {widgets}
        runs={visibleRuns}
        {series}
        {runStates}
        {colors}
        editing={!readOnly}
        onChange={updateWidgets}
      />
    {/if}
  </div>
</div>

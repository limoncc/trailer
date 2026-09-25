<script lang="ts">
  // ─── Explore 分析工作区:看板化后的唯一 state 持有者 ───
  // 持有 title / 选中与隐藏 run / widgets / series 缓存 / run 状态 / 稳定配色,
  // 负责加载、保存与回调驱动的刷新;渲染全部交给 ExploreBoard(DashboardGrid 复用)。
  import { onMount } from 'svelte';
  import { refreshInterval } from '$lib/refresh.svelte';
  import RunPicker from '$lib/components/RunPicker.svelte';
  import ExploreBoard from '$lib/components/ExploreBoard.svelte';
  import { api } from '$lib/utils/api';
  import type { MetricRef, RunRecord, SeriesData } from '$lib/utils/explore';
  import { loadSeries, parseSummaryKey, refreshSeriesIncremental } from '$lib/utils/explore';
  import type { DashWidget } from '$lib/utils/dashboard';
  import { defaultSize, newWidgetId, serializeLayout } from '$lib/utils/dashboard';
  import { assignStableColors, lineSeriesKeys, runScopeKeys } from '$lib/utils/exploreWidgets';

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
  /** 稳定配色表分两条通道累积,只增不减(显隐/排序不换色),在事件回调里维护:
   *  seriesColors = line 卡的 (run, 指标) 组合键;runColors = run 级卡的 run_id/维度值。
   *  分表的原因:混一张表时 run_id 先占走前 N 槽,line 卡首条线会拿到中间槽 → 颜色不按色板顺序。 */
  let seriesColors = $state<Map<string, string>>(new Map());
  let runColors = $state<Map<string, string>>(new Map());
  /** 键空间天然分离(系列键含 '|'),合并即查询视图 */
  const colors = $derived(new Map([...runColors, ...seriesColors]));
  let loading = $state(true);
  // svelte-ignore state_referenced_locally
  let title = $state(initialTitle);
  /** Runs 显隐下拉(会话态,不入库) */
  let runMenuOpen = $state(false);
  let runFilter = $state('');
  let saving = $state(false);
  let saveMsg = $state<{ text: string; ok: boolean } | null>(null);
  let msgTimer: ReturnType<typeof setTimeout> | undefined;

  /** 选中 run(保持选中顺序,含被隐藏的 —— 下拉列表用) */
  const selectedRecords = $derived(runs.filter((r) => selectedRuns.has(r.run_id)));
  /** 可见 run = 选中(保持选中顺序)且未被隐藏 */
  const visibleRuns = $derived(selectedRecords.filter((r) => !hiddenRuns.has(r.run_id)));
  /** 下拉里按名称过滤 */
  const menuRuns = $derived(
    runFilter.trim()
      ? selectedRecords.filter((r) =>
          `${r.name ?? ''} ${r.run_id}`.toLowerCase().includes(runFilter.trim().toLowerCase())
        )
      : selectedRecords
  );

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

  /** 把当前需要的色值补进配色表(事件回调中调用,只增不减):
   *  run 级键 + line 卡的 (run, 指标) 组合键 + 各卡非 run colorBy 的解析值 */
  function syncColors() {
    runColors = assignStableColors(runColors, [...selectedRuns, ...runScopeKeys(selectedRecords, widgets)]);
    seriesColors = assignStableColors(seriesColors, lineSeriesKeys(selectedRecords, widgets, series));
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

  // ─── 实时刷新:唯一的 $effect = 轮询定时器 ───
  // 同步体只读 $refreshInterval(需随它重建定时器,这是用 effect 而非 onMount 的理由);
  // poll() 内对 selectedRuns/hiddenRuns/widgets/runStates 的读写都在 interval 回调里
  // ——回调不被追踪,不构成「effect 内更新状态」与依赖循环(同 run 页/compare 先例)。
  $effect(() => {
    const iv = $refreshInterval;
    if (iv <= 0) return;
    const t = setInterval(poll, iv * 1000);
    return () => clearInterval(t);
  });

  async function poll() {
    const ids = [...selectedRuns];
    if (ids.length === 0) return;
    // ① 轻量刷 run 状态(不轮询 /runs:payload 含全量 config 太重)
    try {
      const resp = await api(`/api/v1/runs/states?run_ids=${encodeURIComponent(ids.join(','))}`);
      if (resp.ok) runStates = new Map(Object.entries(await resp.json()) as Array<[string, string]>);
    } catch {
      /* 单次失败保持旧状态,下轮再试 */
    }
    // ② 可见且运行中的 run 才增量补点(打开时/编辑指标的全量加载另有回调驱动)
    const live = visibleRuns.filter((r) => runStates.get(r.run_id) === 'running');
    if (live.length === 0) return;
    await refreshSeriesIncremental(series, live, collectNeededMetrics(widgets), 500);
    series = new Map(series);
  }

  function toggleSelect(runId: string, checked: boolean) {
    const next = new Set(selectedRuns);
    if (checked) {
      next.add(runId);
    } else {
      next.delete(runId);
      series.delete(runId); // 卸选清缓存,避免重选时拿到陈旧点集
    }
    selectedRuns = next;
    refreshSeries();
  }

  function clearSelection() {
    selectedRuns = new Set();
    series = new Map();
    refreshSeries();
  }

  /** Runs 显隐下拉:会话态剔除 run(全卡同步),不入库 —— 隐藏后其余系列配色不变 */
  function toggleHidden(runId: string) {
    const next = new Set(hiddenRuns);
    if (next.has(runId)) next.delete(runId);
    else next.add(runId);
    hiddenRuns = next;
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
    <!-- Runs 显隐:全卡剔除 run(readOnly 也可用,会话态不入库) -->
    {#if selectedRecords.length > 0}
      <div class="relative" onfocusout={() => setTimeout(() => (runMenuOpen = false), 200)}>
        <button
          type="button"
          class="px-2.5 py-1.5 text-xs border border-border rounded-md hover:bg-accent/50 transition-colors"
          onclick={(e) => { e.stopPropagation(); runMenuOpen = !runMenuOpen; }}
        >
          Runs {visibleRuns.length}/{selectedRecords.length}
        </button>
        {#if runMenuOpen}
          <div class="fixed inset-0 z-10" role="presentation" onclick={() => (runMenuOpen = false)} onkeydown={(e) => { if (e.key === 'Escape') runMenuOpen = false; }}></div>
          <div class="absolute top-full left-0 mt-1 w-60 bg-card border border-border rounded-md shadow-lg z-20 py-1 max-h-72 flex flex-col">
            <div class="px-2 py-1.5 border-b border-border">
              <input
                type="text"
                placeholder="Filter runs..."
                bind:value={runFilter}
                class="w-full px-2 py-1 text-xs border border-border rounded bg-background"
                onclick={(e) => e.stopPropagation()}
              />
            </div>
            <div class="overflow-y-auto flex-1">
              {#each menuRuns as r (r.run_id)}
                <label class="flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-accent cursor-pointer">
                  <input type="checkbox" checked={!hiddenRuns.has(r.run_id)} onchange={() => toggleHidden(r.run_id)} />
                  <span class="font-mono truncate">{r.name || r.run_id.slice(0, 12)}</span>
                </label>
              {/each}
            </div>
            <div class="border-t border-border px-3 py-1.5 flex gap-2 text-[10px]">
              <button type="button" class="underline text-muted-foreground" onclick={() => (hiddenRuns = new Set())}>Show all</button>
            </div>
          </div>
        {/if}
      </div>
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

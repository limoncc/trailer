<script lang="ts">
  // ─── Boards tab:run 下多个命名看板(子标签),12 列网格自由布局 ───
  import { onMount } from 'svelte';
  import { Plus, Pencil, Check, LayoutDashboard, Magnet, X, Play, Pause } from 'lucide-svelte';
  import { refreshInterval } from '$lib/refresh.svelte';
  import { authReady } from '$lib/utils/auth';
  import { isShareView } from '$lib/utils/shareView';
  import type { MetricRef } from '$lib/utils/explore';
  import type { MetricOption } from '$lib/utils/metricGroups';
  import { displayMetricName } from '$lib/utils/systemMetrics';
  import { clipBoardsData, clipMetrics, dataStepRange } from '$lib/utils/replay';
  import {
    parseLayout,
    serializeLayout,
    newWidgetId,
    defaultWidgets,
    defaultSize,
    type DashWidget,
    type RunInfo,
  } from '$lib/utils/dashboard';
  import type { BoardsData, MetricSeries } from './boardsData';
  import { EMPTY_BOARDS_DATA, fetchBoardsData } from './boardsData';
  import DashboardGrid from './DashboardGrid.svelte';
  import WidgetPickerDialog from './WidgetPickerDialog.svelte';

  interface BoardItem {
    id: string;
    run_id: string;
    title: string;
    layout: string;
    created_at: number;
    updated_at: number;
  }

  interface Props {
    runId: string;
    metrics: MetricSeries[];
    metricOptions: MetricOption[];
    runState: string;
    runInfo?: RunInfo;
  }

  let { runId, metrics, metricOptions, runState, runInfo }: Props = $props();

  let dashes = $state<BoardItem[]>([]);
  let activeId = $state<string | null>(null);
  let widgets = $state<DashWidget[]>([]);
  /** 吸附模式:卡片间无间距(随看板持久化) */
  let compact = $state(false);
  let loading = $state(true);
  let editing = $state(false);
  let error = $state('');

  let boardsData = $state<BoardsData>(EMPTY_BOARDS_DATA);

  let activeBoard = $derived(dashes.find((d) => d.id === activeId) ?? null);

  // 工具栏平滑控件:作用域为本看板所有 line 卡(便于整体看趋势)。
  // 卡片各自保留 smooth 值;按最大值展示,卡间不一致时显示 * 提示,点按即统一。
  let lineWidgetCount = $derived(widgets.filter((w) => w.type === 'line').length);
  let boardSmooth = $derived(
    lineWidgetCount === 0
      ? 0
      : Math.max(...widgets.filter((w) => w.type === 'line').map((w) => (w as { smooth?: number }).smooth ?? 0))
  );
  let mixedSmooth = $derived(
    lineWidgetCount > 0 &&
      widgets.some((w) => w.type === 'line' && ((w as { smooth?: number }).smooth ?? 0) !== boardSmooth)
  );

  function setBoardSmooth(next: number) {
    const v = Math.min(20, Math.max(0, next));
    // 先在本地算出新数组再赋值+保存:避免连续点击时读 $derived 的时序问题,
    // 也保证保存的内容就是屏幕上应用的内容
    const updated = widgets.map((w) => (w.type === 'line' ? { ...w, smooth: v } : w));
    widgets = updated;
    saveLayout(updated);
  }

  // 工具栏 X 轴切换(Step/Wall Time,同 MetricCard 语义):作用域为本看板所有 line 卡。
  // 按第一张 line 卡展示,卡间不一致显示 *,点按即统一。
  let boardXKind = $derived(
    lineWidgetCount === 0
      ? 'step'
      : ((((widgets.find((w) => w.type === 'line') as { xKind?: string })?.xKind ?? 'step') === 'wall_time')
          ? 'wall_time'
          : 'step')
  );
  let mixedXKind = $derived(
    lineWidgetCount > 0 &&
      widgets.some((w) => w.type === 'line' && (((w as { xKind?: string }).xKind ?? 'step') !== boardXKind))
  );

  function setBoardXKind(next: 'step' | 'wall_time') {
    const updated = widgets.map((w) => (w.type === 'line' ? { ...w, xKind: next } : w));
    widgets = updated;
    saveLayout(updated);
  }

  function toggleCompact() {
    compact = !compact;
    saveLayout(widgets);
  }

  async function api(url: string, init?: RequestInit) {
    const resp = await fetch(url, init);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return resp;
  }

  // 改名输入框挂载即聚焦全选,避免"点了改名但没焦点"导致打字无效/误提交
  function focusOnMount(node: HTMLInputElement) {
    node.focus();
    node.select();
  }

  async function loadBoards() {
    await authReady();
    try {
      const resp = await api(`/api/v1/runs/${encodeURIComponent(runId)}/dashboards`);
      dashes = await resp.json();
      if (dashes.length > 0) {
        const keep = dashes.find((d) => d.id === activeId) ?? dashes[0];
        activeId = keep.id;
        const parsed = parseLayout(keep.layout);
        widgets = parsed.widgets;
        compact = parsed.compact ?? false;
      } else {
        activeId = null;
        widgets = [];
        compact = false;
      }
      error = '';
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to load boards';
    } finally {
      loading = false;
    }
  }

  async function loadLogData(prev?: BoardsData) {
    boardsData = await fetchBoardsData(runId, prev ?? boardsData);
  }

  // 组件仅在 Boards tab 激活时挂载,runId 生命周期内不变 → onMount 拉初始数据
  onMount(() => {
    loadBoards();
    loadLogData(EMPTY_BOARDS_DATA);
  });

  // 运行中 run:按全局刷新间隔拉新 hist/figure/text/table/media(line 走 run 页轮询)。
  // 定时器+网络请求属于 effect 的合法用途(外部副作用),随 runState/间隔变化重建。
  $effect(() => {
    if (runState !== 'running' || $refreshInterval <= 0) return;
    const timer = setInterval(() => loadLogData(), $refreshInterval * 1000);
    return () => clearInterval(timer);
  });

  // ─── 训练回放:全局步进,截断注入 widget 的数据重放训练过程 ───
  // 1× = 全程 20 秒播完;100ms 一 tick;播完停在终点,✕ 退出回到实时数据。状态不持久化。
  const REPLAY_BASE_SECONDS = 20;
  const REPLAY_TICK_MS = 100;
  const REPLAY_SPEEDS = [1, 2, 4, 8, 16, 32];
  let replayActive = $state(false);
  let replayPlaying = $state(false);
  let replayStep = $state(0);
  let replaySpeed = $state(1);
  let replayDragging = false; // 非响应式:仅进度条指针事件内使用

  let stepRange = $derived(dataStepRange(metrics, boardsData));
  let replayMin = $derived(stepRange?.min ?? 0);
  let replayMax = $derived(stepRange?.max ?? 0);
  let replayProgressPct = $derived(
    replayMax > replayMin ? ((replayStep - replayMin) / (replayMax - replayMin)) * 100 : 0
  );

  // 回放视图:截断后的数据(非回放态原引用透传,零额外渲染);
  // 回放中强制 running=false,抑制 line 最新点脉冲与 info 头部 "in progress"。
  let viewMetrics = $derived(replayActive ? clipMetrics(metrics, replayStep) : metrics);
  let viewBoardsData = $derived(replayActive ? clipBoardsData(boardsData, replayStep) : boardsData);
  let viewRunning = $derived(replayActive ? false : runState === 'running');

  // 回放推进定时器(外部副作用,同上轮询模式)。
  // 墙钟锚定:每 tick 按 Date.now() 换算应处 step——定时器被浏览器限流时
  // (后台 tab 钳到 1s)也能自校正,全程仍按真实 REPLAY_BASE_SECONDS 完成。
  let replayAnchor = 0; // 锚点:replayStartWall 时刻对应的 step
  let replayStartWall = 0; // 锚点墙上时刻(ms)
  $effect(() => {
    if (!replayActive || !replayPlaying) return;
    const speed = replaySpeed; // 同步读取注册依赖:变速时重锚,不跳变
    replayAnchor = replayStep;
    replayStartWall = Date.now();
    const timer = setInterval(() => {
      const elapsedReplayMs = (Date.now() - replayStartWall) * speed;
      const step = Math.round(replayAnchor + (elapsedReplayMs / (REPLAY_BASE_SECONDS * 1000)) * (replayMax - replayMin));
      if (step >= replayMax) {
        replayStep = replayMax;
        replayPlaying = false;
      } else if (step > replayStep) {
        replayStep = Math.max(replayMin, step);
      }
    }, REPLAY_TICK_MS);
    return () => clearInterval(timer);
  });

  function startReplay() {
    if (!stepRange) return;
    replayActive = true;
    replayPlaying = true;
    replayStep = stepRange.min;
  }
  function exitReplay() {
    replayActive = false;
    replayPlaying = false;
  }
  function toggleReplayPlay() {
    if (!replayActive || !stepRange) return;
    // 终点处再按 ▶ = 从头重播
    if (!replayPlaying && replayStep >= replayMax) replayStep = replayMin;
    replayPlaying = !replayPlaying;
  }
  function seekReplay(step: number) {
    replayStep = Math.min(replayMax, Math.max(replayMin, Math.round(step)));
    // 播放中拖拽/跳转:以新位置重锚,避免下一 tick 被旧锚点拉回
    replayAnchor = replayStep;
    replayStartWall = Date.now();
  }
  function seekReplayFromPointer(clientX: number, el: HTMLElement | null) {
    if (!el || replayMax <= replayMin) return;
    const rect = el.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    seekReplay(replayMin + ratio * (replayMax - replayMin));
  }
  function replaySliderKey(e: KeyboardEvent) {
    const span = replayMax - replayMin;
    const step = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? Math.max(1, Math.round(span / 50))
      : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -Math.max(1, Math.round(span / 50)) : 0;
    if (step === 0) return;
    e.preventDefault();
    seekReplay(replayStep + step);
  }

  // ─── 看板 CRUD ───
  // 分享链接只读视图(?token= 匿名访问):写接口服务端一律 401,UI 隐藏写入口、跳过自动保存
  const readonly = isShareView();
  async function createBoard() {
    try {
      const title = `Board ${dashes.length + 1}`;
      const resp = await api(`/api/v1/runs/${encodeURIComponent(runId)}/dashboards`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title }),
      });
      const { id } = await resp.json();
      await loadBoards();
      activeId = id;
      widgets = [];
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to create board';
    }
  }

  /** 写入串行化:快速连续调整(平滑 ± 连点/拖拽)时多个 PUT 并行会乱序落库,
   *  用 promise 链保证按调用顺序写入,最后一次调用即最终状态。 */
  let saveChain: Promise<void> = Promise.resolve();

  async function saveLayout(widgetsToSave: DashWidget[], boardId?: string) {
    if (readonly) return;
    const id = boardId ?? activeId;
    if (!id) return;
    const layout = serializeLayout({ version: 3, widgets: widgetsToSave, compact });
    const d = dashes.find((x) => x.id === id);
    if (d) d.layout = layout;
    saveChain = saveChain.then(async () => {
      try {
        await api(`/api/v1/dashboards/${id}`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ layout }),
        });
      } catch (e) {
        error = e instanceof Error ? e.message : 'Failed to save board';
      }
    });
    await saveChain;
  }

  function onWidgetsChange(next: DashWidget[]) {
    widgets = next;
    saveLayout(next);
  }

  async function switchBoard(id: string) {
    if (id === activeId) return;
    editing = false;
    activeId = id;
    const d = dashes.find((x) => x.id === id);
    const parsed = parseLayout(d?.layout);
    widgets = parsed.widgets;
    compact = parsed.compact ?? false;
  }

  async function deleteBoard(board: BoardItem) {
    if (!confirm(`Delete board "${board.title}"?`)) return;
    try {
      await api(`/api/v1/dashboards/${board.id}`, { method: 'DELETE' });
      const idx = dashes.findIndex((d) => d.id === board.id);
      dashes = dashes.filter((d) => d.id !== board.id);
      const next = dashes[Math.min(idx, dashes.length - 1)];
      activeId = next?.id ?? null;
      const parsed = next ? parseLayout(next.layout) : null;
      widgets = parsed?.widgets ?? [];
      compact = parsed?.compact ?? false;
      if (activeId === null) editing = false;
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to delete board';
    }
  }

  // ─── 看板重命名 ───
  let renamingId = $state<string | null>(null);
  let renameValue = $state('');

  function startRename(board: BoardItem) {
    renamingId = board.id;
    renameValue = board.title;
  }
  async function commitRename() {
    const id = renamingId;
    const t = renameValue.trim();
    renamingId = null;
    if (!id || !t) return;
    const d = dashes.find((x) => x.id === id);
    if (!d || d.title === t) return;
    try {
      await api(`/api/v1/dashboards/${id}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: t }),
      });
      d.title = t;
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to rename board';
    }
  }

  // ─── Widget 增改 ───
  let pickerOpen = $state(false);
  let pickerEdit: DashWidget | null = $state(null);

  function openAdd() {
    pickerEdit = null;
    pickerOpen = true;
  }
  function openEditContent(widget: DashWidget) {
    pickerEdit = widget;
    pickerOpen = true;
  }

  async function onPickerConfirm(type: DashWidget['type'], content: Record<string, unknown>) {
    pickerOpen = false;
    if (pickerEdit) {
      const next = widgets.map((w) => (w.id === pickerEdit!.id ? ({ ...w, ...content } as DashWidget) : w));
      widgets = next;
      pickerEdit = null;
      saveLayout(next);
      return;
    }
    const size = defaultSize(type);
    const widget = { id: newWidgetId(), type, title: undefined, w: size.w, h: size.h, ...content } as DashWidget;
    const next = [...widgets, widget];
    widgets = next;
    saveLayout(next);
  }

  function generateDefault() {
    if (metricOptions.length === 0) return;
    const refs: MetricRef[] = metricOptions.map((m) => ({ key: m.key, context: m.context }));
    widgets = defaultWidgets(refs);
    saveLayout(widgets);
  }

  function toggleEditing() {
    editing = !editing;
    if (!editing) saveLayout(widgets);
  }

  function formatLabel(m: MetricRef): string {
    return displayMetricName(m.key, m.context) ?? (m.context ? `${m.key} [${m.context}]` : m.key);
  }
</script>

<div class="w-full">
  {#if loading}
    <div class="text-center text-muted-foreground py-12">Loading boards…</div>
  {:else}
    <!-- 子标签条 -->
    <div class="flex items-center gap-1 border-b border-border mb-3 flex-wrap">
      {#each dashes as d (d.id)}
        <div
          class="flex items-center gap-1 px-3 py-1.5 text-xs cursor-pointer border-b-2 -mb-px transition-colors group/tab {activeId === d.id
            ? 'border-primary font-medium text-foreground'
            : 'border-transparent text-muted-foreground hover:text-foreground'}"
          onclick={() => switchBoard(d.id)}
          role="button"
          tabindex="0"
          onkeydown={(e) => { if (e.key === 'Enter') switchBoard(d.id); }}
        >
          {#if renamingId === d.id}
            <input
              use:focusOnMount
              bind:value={renameValue}
              onclick={(e) => e.stopPropagation()}
              onblur={commitRename}
              onkeydown={(e) => {
                if (e.key === 'Enter') commitRename();
                if (e.key === 'Escape') renamingId = null;
              }}
              class="px-1 py-0.5 w-28 text-xs border border-border rounded bg-background font-mono"
            />
          {:else}
            <span
              role="button"
              tabindex="-1"
              ondblclick={(e) => { e.stopPropagation(); startRename(d); }}
              onkeydown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); startRename(d); } }}
            >{d.title}</span>
          {/if}
          {#if renamingId === d.id}
            <button
              class="text-muted-foreground hover:text-foreground"
              title="Save name"
              onclick={(e) => { e.stopPropagation(); commitRename(); }}
            >
              <Check size={12} />
            </button>
          {/if}
          {#if !readonly}
            <button
              class="opacity-0 group-hover/tab:opacity-100 text-muted-foreground hover:text-foreground"
              title="Rename board"
              onclick={(e) => { e.stopPropagation(); startRename(d); }}
            >
              <Pencil size={11} />
            </button>
          {/if}
          {#if !readonly}
            <button
              class="opacity-0 group-hover/tab:opacity-100 text-muted-foreground hover:text-destructive"
              title="Delete board"
              onclick={(e) => { e.stopPropagation(); deleteBoard(d); }}
            >
              <X size={12} />
            </button>
          {/if}
        </div>
      {/each}
      {#if !readonly}
        <button
          class="flex items-center gap-1 px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground"
          onclick={createBoard}
          title="New board"
        >
          <Plus size={13} /> New Board
        </button>
      {/if}

      <div class="ml-auto flex items-center gap-2 pb-1 flex-wrap">
        {#if error}
          <span class="text-xs text-destructive">{error}</span>
        {/if}
        {#if activeBoard}
          <!-- 训练回放(X: Step 前):未激活一键开启;激活后展开 播放/进度/速度/退出 -->
          {#if replayActive}
            <span class="flex items-center gap-2 px-2 py-1 border border-border rounded-md">
              <button
                class="text-xs text-muted-foreground hover:text-foreground disabled:opacity-30"
                disabled={replayMax <= replayMin}
                title={replayPlaying ? 'Pause replay' : replayStep >= replayMax ? 'Replay from start' : 'Play replay'}
                onclick={toggleReplayPlay}
              >
                {#if replayPlaying}<Pause size={12} />{:else}<Play size={12} />{/if}
              </button>
              <div
                role="slider"
                tabindex="0"
                aria-label="Replay progress"
                aria-valuemin={replayMin}
                aria-valuemax={replayMax}
                aria-valuenow={replayStep}
                aria-valuetext={`Step ${replayStep} of ${replayMax}`}
                class="trailer-slider relative h-5 w-36 cursor-pointer touch-none select-none"
                onpointerdown={(e) => { replayDragging = true; seekReplayFromPointer(e.clientX, e.currentTarget); }}
                onpointermove={(e) => { if (replayDragging) seekReplayFromPointer(e.clientX, e.currentTarget); }}
                onpointerup={() => { replayDragging = false; }}
                onpointerleave={() => { replayDragging = false; }}
                onkeydown={replaySliderKey}
              >
                <div class="absolute inset-y-0 left-0 my-auto h-1 w-full rounded-full bg-border"></div>
                <div class="absolute inset-y-0 left-0 my-auto h-1 rounded-full bg-primary" style="width: {replayProgressPct}%"></div>
                <div
                  class="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-background bg-primary shadow"
                  style="left: {replayProgressPct}%"
                ></div>
              </div>
              <span class="shrink-0 text-xs text-muted-foreground tabular-nums">step {replayStep}/{replayMax}</span>
              <span class="flex items-center gap-px border border-border rounded-md overflow-hidden" title="Replay speed (1× = full run in {REPLAY_BASE_SECONDS}s)">
                {#each REPLAY_SPEEDS as s (s)}
                  <button
                    class="px-1.5 py-0.5 text-[11px] {replaySpeed === s ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-accent/50'}"
                    onclick={() => (replaySpeed = s)}
                  >{s}×</button>
                {/each}
              </span>
              <button
                class="text-muted-foreground hover:text-foreground"
                title="Exit replay (back to live data)"
                onclick={exitReplay}
              >
                <X size={12} />
              </button>
            </span>
          {:else}
            <button
              class="flex items-center gap-1 px-2.5 py-1 text-xs border border-border rounded-md hover:bg-accent disabled:opacity-40 disabled:pointer-events-none"
              disabled={!stepRange}
              title="Replay the training process (data sweeps from first to last step)"
              onclick={startReplay}
            >
              <Play size={12} /> Replay
            </button>
          {/if}
          {#if lineWidgetCount > 0}
            <button
              class="px-2 py-1 text-xs border border-border rounded-md hover:bg-accent"
              title="X axis for all line cards (Step / Wall Time)"
              onclick={() => setBoardXKind(boardXKind === 'step' ? 'wall_time' : 'step')}
            >
              X: {boardXKind === 'step' ? 'Step' : 'Wall Time'}{#if mixedXKind}<span
                  class="text-muted-foreground"
                  title="Cards use different X axis">*</span
                >{/if}
            </button>
          {/if}
          {#if lineWidgetCount > 0}
            <span
              class="flex items-center gap-1 px-2 py-1 text-xs border border-border rounded-md"
              title={mixedSmooth
                ? 'Smoothing (cards differ — click to unify)'
                : 'Smoothing for all line cards (0 = raw, 1-20 = moving average)'}
            >
              <span class="text-muted-foreground">Smooth</span>
              <button
                class="px-1 hover:text-foreground disabled:opacity-30"
                disabled={boardSmooth <= 0}
                onclick={() => setBoardSmooth(boardSmooth - 1)}
              >−</button>
              <span class="w-4 text-center tabular-nums">{boardSmooth}</span>
              <button
                class="px-1 hover:text-foreground disabled:opacity-30"
                disabled={boardSmooth >= 20}
                onclick={() => setBoardSmooth(boardSmooth + 1)}
              >+</button>
              {#if mixedSmooth}
                <span class="text-muted-foreground" title="Cards use different smoothing">*</span>
              {/if}
            </span>
          {/if}
          {#if !readonly}
            <button
              class="flex items-center gap-1 px-2.5 py-1 text-xs border border-border rounded-md hover:bg-accent"
              onclick={openAdd}
            >
              <Plus size={12} /> Add Chart
            </button>
            <button
              class="flex items-center gap-1 px-2.5 py-1 text-xs rounded-md {compact
                ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                : 'border border-border hover:bg-accent'}"
              title="Snap cards together (no gap)"
              onclick={toggleCompact}
            >
              <Magnet size={12} /> Snap
            </button>
            <button
              class="flex items-center gap-1 px-2.5 py-1 text-xs rounded-md {editing
                ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                : 'border border-border hover:bg-accent'}"
              onclick={toggleEditing}
            >
              {#if editing}
                <Check size={12} /> Done
              {:else}
                <LayoutDashboard size={12} /> Edit Layout
              {/if}
            </button>
          {/if}
        {/if}
      </div>
    </div>

    {#if !activeBoard}
      <div class="text-center py-16">
        <p class="text-sm text-muted-foreground mb-3">No boards yet. Create a dashboard to arrange metrics and logs your way.</p>
        {#if !readonly}
          <button
            class="px-3 py-1.5 text-xs rounded-md bg-primary text-primary-foreground hover:bg-primary/90"
            onclick={createBoard}
          >
            Create your first board
          </button>
        {/if}
      </div>
    {:else if widgets.length === 0}
      <div class="text-center py-16">
        <p class="text-sm text-muted-foreground mb-3">This board is empty.</p>
        {#if !readonly}
          <div class="flex items-center justify-center gap-2">
            <button
              class="px-3 py-1.5 text-xs rounded-md bg-primary text-primary-foreground hover:bg-primary/90"
              onclick={openAdd}
            >
              Add Chart
            </button>
            {#if metricOptions.length > 0}
              <button
                class="px-3 py-1.5 text-xs border border-border rounded-md hover:bg-accent"
                onclick={generateDefault}
              >
                Generate from metrics
              </button>
            {/if}
          </div>
        {/if}
      </div>
    {:else}
      <DashboardGrid
        {widgets}
        {editing}
        {runId}
        metrics={viewMetrics}
        boardsData={viewBoardsData}
        running={viewRunning}
        {runState}
        {runInfo}
        {compact}
        replayStep={replayActive ? replayStep : null}
        onChange={onWidgetsChange}
        onEditContent={openEditContent}
      />
    {/if}
  {/if}
</div>

{#if pickerOpen}
  <WidgetPickerDialog
    editWidget={pickerEdit}
    {metricOptions}
    boardsData={boardsData}
    {runInfo}
    onConfirm={onPickerConfirm}
    onClose={() => (pickerOpen = false)}
  />
{/if}

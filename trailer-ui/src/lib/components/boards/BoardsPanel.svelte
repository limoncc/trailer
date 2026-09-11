<script lang="ts">
  // ─── Boards tab:run 下多个命名看板(子标签),12 列网格自由布局 ───
  import { onMount } from 'svelte';
  import { Plus, Pencil, Check, LayoutDashboard, X } from 'lucide-svelte';
  import { refreshInterval } from '$lib/refresh.svelte';
  import { authReady } from '$lib/utils/auth';
  import type { MetricRef } from '$lib/utils/explore';
  import type { MetricOption } from '$lib/utils/metricGroups';
  import { displayMetricName } from '$lib/utils/systemMetrics';
  import {
    parseLayout,
    serializeLayout,
    newWidgetId,
    defaultWidgets,
    defaultSize,
    type DashWidget,
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
  }

  let { runId, metrics, metricOptions, runState }: Props = $props();

  let dashes = $state<BoardItem[]>([]);
  let activeId = $state<string | null>(null);
  let widgets = $state<DashWidget[]>([]);
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
        widgets = parseLayout(keep.layout).widgets;
      } else {
        activeId = null;
        widgets = [];
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

  // ─── 看板 CRUD ───
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
    const id = boardId ?? activeId;
    if (!id) return;
    const layout = serializeLayout({ version: 1, widgets: widgetsToSave });
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
    widgets = parseLayout(d?.layout).widgets;
  }

  async function deleteBoard(board: BoardItem) {
    if (!confirm(`Delete board "${board.title}"?`)) return;
    try {
      await api(`/api/v1/dashboards/${board.id}`, { method: 'DELETE' });
      const idx = dashes.findIndex((d) => d.id === board.id);
      dashes = dashes.filter((d) => d.id !== board.id);
      const next = dashes[Math.min(idx, dashes.length - 1)];
      activeId = next?.id ?? null;
      widgets = next ? parseLayout(next.layout).widgets : [];
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
            <span ondblclick={(e) => { e.stopPropagation(); startRename(d); }}>{d.title}</span>
          {/if}
          {#if renamingId === d.id}
            <button
              class="text-muted-foreground hover:text-foreground"
              title="Save name"
              onclick={(e) => { e.stopPropagation(); commitRename(); }}
            >
              <Check size={12} />
            </button>
          {:else}
            <button
              class="opacity-0 group-hover/tab:opacity-100 text-muted-foreground hover:text-foreground"
              title="Rename board"
              onclick={(e) => { e.stopPropagation(); startRename(d); }}
            >
              <Pencil size={11} />
            </button>
          {/if}
          <button
            class="opacity-0 group-hover/tab:opacity-100 text-muted-foreground hover:text-destructive"
            title="Delete board"
            onclick={(e) => { e.stopPropagation(); deleteBoard(d); }}
          >
            <X size={12} />
          </button>
        </div>
      {/each}
      <button
        class="flex items-center gap-1 px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground"
        onclick={createBoard}
        title="New board"
      >
        <Plus size={13} /> New Board
      </button>

      <div class="ml-auto flex items-center gap-2 pb-1">
        {#if error}
          <span class="text-xs text-destructive">{error}</span>
        {/if}
        {#if activeBoard}
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
          <button
            class="flex items-center gap-1 px-2.5 py-1 text-xs border border-border rounded-md hover:bg-accent"
            onclick={openAdd}
          >
            <Plus size={12} /> Add Chart
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
      </div>
    </div>

    {#if !activeBoard}
      <div class="text-center py-16">
        <p class="text-sm text-muted-foreground mb-3">No boards yet. Create a dashboard to arrange metrics and logs your way.</p>
        <button
          class="px-3 py-1.5 text-xs rounded-md bg-primary text-primary-foreground hover:bg-primary/90"
          onclick={createBoard}
        >
          Create your first board
        </button>
      </div>
    {:else if widgets.length === 0}
      <div class="text-center py-16">
        <p class="text-sm text-muted-foreground mb-3">This board is empty.</p>
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
      </div>
    {:else}
      <DashboardGrid
        {widgets}
        {editing}
        {runId}
        {metrics}
        data={boardsData}
        running={runState === 'running'}
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
    onConfirm={onPickerConfirm}
    onClose={() => (pickerOpen = false)}
  />
{/if}

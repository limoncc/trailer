<script lang="ts">
  // ─── 看板网格:24 列 dense 布局 ───
  // 编辑态:把手 pointer 拖拽换位(不用 HTML5 DnD——真实拖拽不可靠且与缩放手柄冲突)、
  // 右下角手柄调宽/高、标题重命名、头部取色;视图态:卡片可折叠(同 Metrics 卡片)。
  // 布局即数组顺序:卡片 span w 列 × h 行,grid-auto-flow: dense 自动填洞。
  import { GripHorizontal, Pencil, X, ChevronDown, ChevronRight, Magnet, ArrowUp, ArrowDown, ArrowLeft, ArrowRight } from 'lucide-svelte';
  import type { DashWidget, RunInfo, SnapDir } from '$lib/utils/dashboard';
  import { clampH, clampW, defaultWidgetTitle, minSize } from '$lib/utils/dashboard';
  import { infoRowsNeeded } from '$lib/utils/infoCard';
  import { displayMetricName } from '$lib/utils/systemMetrics';
  import type { BoardsData, MetricSeries } from './boardsData';
  import WidgetContent from './WidgetContent.svelte';
import { onMount } from 'svelte';

  interface Props {
    widgets: DashWidget[];
    editing: boolean;
    runId: string;
    metrics: MetricSeries[];
    boardsData: BoardsData;
    /** run 运行中:line 图最新点显示绿色脉冲标记(同 Metrics 卡片) */
    running?: boolean;
    /** 信息卡状态文本用 */
    runState?: string;
    /** 信息卡所需的 run 元信息(时长/成本/超参/卡数) */
    runInfo?: RunInfo;
    /** 吸附模式:卡片间无间距 */
    compact?: boolean;
    /** 拖拽/缩放/删除/取色等布局变更 */
    onChange: (widgets: DashWidget[]) => void;
    /** 「编辑内容」按钮 → 父组件打开选择弹窗 */
    onEditContent: (widget: DashWidget) => void;
  }

  let { widgets, editing, runId, metrics, boardsData, running = false, runState = '', runInfo, compact = false, onChange, onEditContent }: Props = $props();

  const ROW_PX = 44;
  const GAP_PX = 8;
  /** 看板容器实际宽度(info 卡自动高度估算用) */
  let gridW = $state(0);
  onMount(() => {
    if (gridEl && typeof ResizeObserver !== 'undefined') {
      gridW = gridEl.clientWidth;
      const ro = new ResizeObserver(() => (gridW = gridEl?.clientWidth ?? 0));
      ro.observe(gridEl);
      return () => ro.disconnect();
    }
  });
  const HEADER_PX = 32;
  /** 36 列网格列数 */
  const COLS = 36;

  function contentHeight(w: number): number {
    return Math.max(80, w * ROW_PX + (w - 1) * GAP_PX - HEADER_PX - 16);
  }

  function titleOf(widget: DashWidget): string {
    return (
      widget.title ??
      defaultWidgetTitle(widget, (m) => displayMetricName(m.key, m.context) ?? `${m.key} [${m.context}]`)
    );
  }

  // ─── 折叠(视图态临时偏好,同 Metrics 卡片,不持久化) ───
  let collapsed = $state<Set<string>>(new Set());
  function toggleCollapse(id: string) {
    const next = new Set(collapsed);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    collapsed = next;
  }

  // ─── 平滑调节(工具栏统一控制本看板所有 line 卡):0=原始线,1..20 → SMA 窗口 2n+1 ───
  // 卡片级别保留各自 smooth 值,但工具栏作用域为整个看板,便于"整体看趋势"。
  let lineWidgets = $derived(widgets.filter((w) => w.type === 'line'));
  let boardSmooth = $derived(lineWidgets.length === 0 ? 0 : Math.max(...lineWidgets.map((w) => (w as { smooth?: number }).smooth ?? 0)));
  let mixedSmooth = $derived(lineWidgets.length > 0 && lineWidgets.some((w) => ((w as { smooth?: number }).smooth ?? 0) !== boardSmooth));

  function setBoardSmooth(next: number) {
    const v = Math.min(20, Math.max(0, next));
    onChange(widgets.map((w) => (w.type === 'line' ? { ...w, smooth: v } : w)));
  }

  // ─── 卡片头取色(编辑态,onChange 持久化) ───
  function setColor(widget: DashWidget, color: string | undefined) {
    onChange(
      widgets.map((w) => (w.id === widget.id ? { ...w, color } : w))
    );
  }

  // ─── 拖拽换位:pointer 事件 + elementFromPoint 命中检测。
  // HTML5 DnD 真实拖拽不可靠,且 draggable 卡片会吞掉缩放手柄的 mousedown。 ───
  let dragId = $state<string | null>(null);
  let overIndex = $state(-1);
  let draggingAny = $derived(dragId !== null);

  function onDragPointerDown(e: PointerEvent, widget: DashWidget) {
    if (!editing || e.button !== 0) return;
    e.preventDefault();
    dragId = widget.id;
    // 指针捕获让移出把手后仍持续收到 move/up;合成事件无活动指针会抛错,忽略
    try {
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
    } catch {}
    const onMove = (ev: PointerEvent) => {
      const hit = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('[data-card-idx]');
      overIndex = hit ? Number(hit.getAttribute('data-card-idx')) : -1;
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      const target = overIndex;
      if (dragId !== null && target >= 0 && widgets[target]?.id !== dragId) {
        const from = widgets.findIndex((w) => w.id === dragId);
        if (from >= 0) {
          const next = [...widgets];
          const [moved] = next.splice(from, 1);
          next.splice(target, 0, moved);
          onChange(next);
        }
      }
      dragId = null;
      overIndex = -1;
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  }

  // ─── 缩放:拖拽中本地预览,鼠标抬起提交 ───
  let resizing = $state<{ id: string; w: number; h: number } | null>(null);
  let gridEl: HTMLDivElement | null = null;

  function effectiveW(widget: DashWidget): number {
    return resizing?.id === widget.id ? resizing.w : widget.w;
  }
  function effectiveH(widget: DashWidget): number {
    // info 卡高度贴合内容(头部条 + 瓦片换行),不留空白也不出滚动条;
    // 优先于 resizing —— 缩放手柄对 info 卡只调宽度
    if (widget.type === 'info') {
      const cardW = gridW > 0 ? (gridW * widget.w) / COLS : 0;
      if (cardW > 0) return infoRowsNeeded(widget, cardW, ROW_PX, GAP_PX);
    }
    return widget.h;
  }

  function onResizeStart(e: MouseEvent, widget: DashWidget) {
    if (!editing) return;
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startY = e.clientY;
    const startW = widget.w;
    const startH = widget.h;
    const rect = gridEl?.getBoundingClientRect();
    const colStep = rect ? rect.width / COLS + GAP_PX : 40;

    const onMove = (ev: MouseEvent) => {
      const dw = Math.round((ev.clientX - startX) / colStep);
      const dh = Math.round((ev.clientY - startY) / (ROW_PX + GAP_PX));
      const min = minSize(widget.type);
      resizing = {
        id: widget.id,
        w: Math.max(min.w, clampW(startW + dw)),
        h: Math.max(min.h, clampH(startH + dh)),
      };
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      if (resizing) {
        onChange(widgets.map((w) => (w.id === resizing!.id ? { ...w, w: resizing!.w, h: resizing!.h } : w)));
      }
      resizing = null;
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  function removeWidget(widget: DashWidget) {
    onChange(widgets.filter((w) => w.id !== widget.id));
  }

  // ─── 重命名标题 ───
  let renameId = $state<string | null>(null);
  let renameValue = $state('');

  function startRename(widget: DashWidget) {
    renameId = widget.id;
    renameValue = titleOf(widget);
  }
  // 未变更时必须完全不动 title:否则 blur 提交会把已有自定义名清回默认名
  // (输入框未聚焦/回车后又 blur 的双触发场景都靠 renameId 置空 early-return 挡掉)
  function commitRename() {
    const id = renameId;
    renameId = null;
    if (!id) return;
    const t = renameValue.trim();
    const current = widgets.find((w) => w.id === id);
    if (!current || !t || t === titleOf(current)) return;
    onChange(widgets.map((w) => (w.id === id ? { ...w, title: t } : w)));
  }

  // ─── 卡片级吸附:该侧与相邻卡片的间距归零。点磁铁弹浮层选方向,再点同方向取消。
  // 浮层用 fixed 定位(记录按钮位置),避免被卡片的 overflow-hidden 裁剪。 ───
  let snapMenu = $state<{ id: string; x: number; y: number } | null>(null);

  function openSnapMenu(e: MouseEvent, widget: DashWidget) {
    e.stopPropagation();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    snapMenu = { id: widget.id, x: r.left, y: r.bottom + 4 };
  }

  function setSnap(widget: DashWidget, dir: SnapDir | undefined) {
    snapMenu = null;
    onChange(widgets.map((w) => (w.id === widget.id ? { ...w, snap: dir } : w)));
  }

  /** 吸附方向的负 margin(该侧间距归零);整体吸附(compact)时不重复生效 */
  function snapMargin(widget: DashWidget): string {
    if (!widget.snap || compact) return '';
    switch (widget.snap) {
      case 'up': return `margin-top: -${GAP_PX}px;`;
      case 'down': return `margin-bottom: -${GAP_PX}px;`;
      case 'left': return `margin-left: -${GAP_PX}px;`;
      case 'right': return `margin-right: -${GAP_PX}px;`;
    }
  }

  /** 双击 info 卡 label 改名:更新对应 item 的 label 并持久化 */
  function handleInfoLabelEdit(widget: DashWidget, itemIdx: number, label: string) {
    if (widget.type !== 'info') return;
    const l = label.trim();
    const items = widget.items.map((it, i) => {
      if (i !== itemIdx) return it;
      if (it.src !== 'config' && it.src !== 'metric') return it;
      return { ...it, label: l || undefined };
    });
    onChange(widgets.map((w) => (w.id === widget.id ? { ...w, items } : w)));
  }

  function focusOnMount(node: HTMLInputElement) {
    node.focus();
    node.select();
  }
</script>

<div
  bind:this={gridEl}
  class="grid"
  class:select-none={draggingAny}
  style="grid-template-columns: repeat({COLS}, minmax(0, 1fr)); grid-auto-rows: {ROW_PX}px; grid-auto-flow: dense; gap: {compact ? 0 : GAP_PX}px;"
>
  {#each widgets as widget, idx (widget.id)}
    {@const isCollapsed = collapsed.has(widget.id)}
    <div
      data-card-idx={idx}
      class="border rounded-md overflow-hidden flex flex-col bg-card relative group/card {editing
        ? 'border-dashed cursor-grab'
        : 'border-border'} {dragId === widget.id ? 'opacity-40' : ''} {dragId !== null && overIndex === idx && dragId !== widget.id
        ? 'ring-2 ring-primary/60'
        : ''}"
      style="grid-column: span {effectiveW(widget)}; grid-row: span {isCollapsed ? 1 : effectiveH(widget)}; {widget.color
        ? `box-shadow: inset 0 2px 0 0 ${widget.color};`
        : ''} {snapMargin(widget)}"
      role="{editing ? 'button' : 'presentation'}"
      tabindex={editing ? 0 : -1}
      onkeydown={(e) => {
        if (editing && (e.key === 'Enter' || e.key === ' ')) e.preventDefault();
      }}
    >
      <!-- Header(info 卡视图态隐藏,整卡即信息面板;编辑态保留以便拖拽/改名/删除) -->
      {#if editing || widget.type !== 'info'}
      <div class="flex items-center gap-1.5 px-2.5 border-b border-border bg-muted/20 shrink-0" style="height: {HEADER_PX}px;">
        {#if editing}
          <span
            class="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground shrink-0 flex items-center touch-none"
            title="Drag to move"
            role="button"
            tabindex="0"
            onpointerdown={(e) => onDragPointerDown(e, widget)}
            onkeydown={(e) => { if (e.key === 'Enter') e.preventDefault(); }}
          >
            <GripHorizontal size={13} />
          </span>
        {/if}
        <button
          class="text-muted-foreground hover:text-foreground shrink-0"
          title={isCollapsed ? 'Expand' : 'Collapse'}
          onclick={() => toggleCollapse(widget.id)}
        >
          {#if isCollapsed}<ChevronRight size={13}/>{:else}<ChevronDown size={13}/>{/if}
        </button>
        {#if widget.color}
          <span class="w-2 h-2 rounded-full shrink-0" style="background:{widget.color}"></span>
        {/if}
        {#if renameId === widget.id}
          <input
            use:focusOnMount
            bind:value={renameValue}
            class="flex-1 min-w-0 px-1.5 py-0.5 text-xs border border-border rounded bg-background font-mono"
            onblur={commitRename}
            onkeydown={(e) => {
              if (e.key === 'Enter') commitRename();
              if (e.key === 'Escape') renameId = null;
            }}
          />
        {:else}
          <span
            class="text-xs font-medium truncate {editing ? 'cursor-text hover:text-primary' : ''}"
            title={titleOf(widget)}
            onclick={editing ? () => startRename(widget) : undefined}
            role={editing ? 'button' : 'presentation'}
            tabindex={editing ? 0 : -1}
            onkeydown={editing ? (e) => { if (e.key === 'Enter') startRename(widget); } : undefined}
          >
            {titleOf(widget)}
          </span>
        {/if}
        {#if editing}
          <button
            class="shrink-0 {widget.snap ? 'text-primary' : 'text-muted-foreground hover:text-foreground'}"
            title={widget.snap ? `Snap: ${widget.snap} (click to change)` : 'Snap to neighbor card'}
            onclick={(e) => openSnapMenu(e, widget)}
          >
            <Magnet size={12} />
          </button>
          <input
            type="color"
            value={widget.color ?? '#6b7280'}
            onchange={(e) => setColor(widget, (e.currentTarget as HTMLInputElement).value)}
            class="w-5 h-5 p-0 border border-border rounded cursor-pointer bg-transparent shrink-0"
            title="Card color"
          />
          {#if widget.color}
            <button
              class="text-muted-foreground hover:text-foreground shrink-0"
              title="Clear color"
              onclick={(e) => { e.stopPropagation(); setColor(widget, undefined); }}
            >
              <X size={11} />
            </button>
          {/if}
          <button
            class="text-muted-foreground hover:text-foreground shrink-0"
            title="Edit content"
            onclick={(e) => { e.stopPropagation(); onEditContent(widget); }}
          >
            <Pencil size={13} />
          </button>
          <button
            class="text-muted-foreground hover:text-destructive shrink-0"
            title="Remove"
            onclick={(e) => { e.stopPropagation(); removeWidget(widget); }}
          >
            <X size={13} />
          </button>
        {/if}
      </div>
      {/if}

      <!-- Content(折叠时隐藏) -->
      {#if !isCollapsed}
        <div class="flex-1 min-h-0 {widget.type === 'info' && !editing ? 'p-0' : 'p-2'} {editing && widget.type !== 'info' ? 'pointer-events-none' : ''}">
          <WidgetContent {widget} {runId} {metrics} data={boardsData} heightPx={contentHeight(effectiveH(widget))} {running} {runState} {runInfo} editing={editing && widget.type === 'info'} onLabelEdit={(itemIdx, label) => handleInfoLabelEdit(widget, itemIdx, label)} />
        </div>

        <!-- Resize handle -->
        {#if editing}
          <div
            class="absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize"
            title="Resize"
            role="button"
            tabindex="0"
            onmousedown={(e) => onResizeStart(e, widget)}
            onkeydown={(e) => { if (e.key === 'Enter') e.preventDefault(); }}
          >
            <svg viewBox="0 0 16 16" class="w-full h-full text-muted-foreground/60">
              <path d="M14 6 L6 14 M14 10 L10 14" stroke="currentColor" stroke-width="1.5" fill="none" />
            </svg>
          </div>
        {/if}
      {/if}
    </div>
  {/each}
</div>

<!-- 卡片吸附方向浮层:渲染在网格外层,固定定位不被卡片 overflow-hidden 裁剪 -->
{#if snapMenu}
  {@const menuAt = snapMenu}
  {@const snapWidget = widgets.find((w) => w.id === menuAt.id)}
  {#if snapWidget}
    <div
      class="fixed inset-0 z-40"
      role="presentation"
      onclick={() => (snapMenu = null)}
      onkeydown={(e) => { if (e.key === 'Escape') snapMenu = null; }}
    ></div>
    <div
      class="fixed z-50 flex items-center gap-0.5 bg-popover border border-border rounded-md shadow-lg p-1"
      style="left: {Math.min(menuAt.x, (typeof window !== 'undefined' ? window.innerWidth : 1280) - 170)}px; top: {menuAt.y}px;"
    >
      <span class="text-[10px] text-muted-foreground px-1">Snap</span>
      <button
        class="p-1 rounded hover:bg-accent {snapWidget.snap === 'up' ? 'text-primary' : 'text-muted-foreground'}"
        title="Close gap above"
        onclick={(e) => { e.stopPropagation(); setSnap(snapWidget, snapWidget.snap === 'up' ? undefined : 'up'); }}
      ><ArrowUp size={12} /></button>
      <button
        class="p-1 rounded hover:bg-accent {snapWidget.snap === 'down' ? 'text-primary' : 'text-muted-foreground'}"
        title="Close gap below"
        onclick={(e) => { e.stopPropagation(); setSnap(snapWidget, snapWidget.snap === 'down' ? undefined : 'down'); }}
      ><ArrowDown size={12} /></button>
      <button
        class="p-1 rounded hover:bg-accent {snapWidget.snap === 'left' ? 'text-primary' : 'text-muted-foreground'}"
        title="Close gap to the left"
        onclick={(e) => { e.stopPropagation(); setSnap(snapWidget, snapWidget.snap === 'left' ? undefined : 'left'); }}
      ><ArrowLeft size={12} /></button>
      <button
        class="p-1 rounded hover:bg-accent {snapWidget.snap === 'right' ? 'text-primary' : 'text-muted-foreground'}"
        title="Close gap to the right"
        onclick={(e) => { e.stopPropagation(); setSnap(snapWidget, snapWidget.snap === 'right' ? undefined : 'right'); }}
      ><ArrowRight size={12} /></button>
      <span class="w-px h-4 bg-border mx-0.5"></span>
      <button
        class="p-1 rounded hover:bg-accent text-muted-foreground"
        title="No snap"
        onclick={(e) => { e.stopPropagation(); setSnap(snapWidget, undefined); }}
      ><X size={12} /></button>
    </div>
  {/if}
{/if}

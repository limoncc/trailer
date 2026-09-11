<script lang="ts">
  // ─── 看板网格:24 列 dense 布局 ───
  // 编辑态:把手 pointer 拖拽换位(不用 HTML5 DnD——真实拖拽不可靠且与缩放手柄冲突)、
  // 右下角手柄调宽/高、标题重命名、头部取色;视图态:卡片可折叠(同 Metrics 卡片)。
  // 布局即数组顺序:卡片 span w 列 × h 行,grid-auto-flow: dense 自动填洞。
  import { GripHorizontal, Pencil, X, ChevronDown, ChevronRight } from 'lucide-svelte';
  import type { DashWidget } from '$lib/utils/dashboard';
  import { clampH, clampW, defaultWidgetTitle } from '$lib/utils/dashboard';
  import { displayMetricName } from '$lib/utils/systemMetrics';
  import type { BoardsData, MetricSeries } from './boardsData';
  import WidgetContent from './WidgetContent.svelte';

  interface Props {
    widgets: DashWidget[];
    editing: boolean;
    runId: string;
    metrics: MetricSeries[];
    boardsData: BoardsData;
    /** run 运行中:line 图最新点显示绿色脉冲标记(同 Metrics 卡片) */
    running?: boolean;
    /** 拖拽/缩放/删除/取色等布局变更 */
    onChange: (widgets: DashWidget[]) => void;
    /** 「编辑内容」按钮 → 父组件打开选择弹窗 */
    onEditContent: (widget: DashWidget) => void;
  }

  let { widgets, editing, runId, metrics, boardsData, running = false, onChange, onEditContent }: Props = $props();

  const ROW_PX = 44;
  const GAP_PX = 12;
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

  // ─── 卡片头取色(编辑态,onChange 持久化) ───
  function setColor(widget: DashWidget, color: string | undefined) {
    onChange(
      widgets.map((w) => (w.id === widget.id ? { ...w, color } : w))
    );
  }

  // ─── 平滑调节(line 卡,视图/编辑态均可):0=原始,1..20 → SMA 窗口 2n+1,随布局持久化 ───
  function setSmooth(widget: DashWidget, next: number) {
    const v = Math.min(20, Math.max(0, next));
    onChange(widgets.map((w) => (w.id === widget.id ? { ...w, smooth: v } : w)));
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
    return resizing?.id === widget.id ? resizing.h : widget.h;
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
      resizing = {
        id: widget.id,
        w: clampW(startW + dw),
        h: clampH(startH + dh),
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

  function focusOnMount(node: HTMLInputElement) {
    node.focus();
    node.select();
  }
</script>

<div
  bind:this={gridEl}
  class="grid"
  class:select-none={draggingAny}
  style="grid-template-columns: repeat({COLS}, minmax(0, 1fr)); grid-auto-rows: {ROW_PX}px; grid-auto-flow: dense; gap: {GAP_PX}px;"
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
        : ''}"
      role="{editing ? 'button' : 'presentation'}"
      tabindex={editing ? 0 : -1}
      onkeydown={(e) => {
        if (editing && (e.key === 'Enter' || e.key === ' ')) e.preventDefault();
      }}
    >
      <!-- Header -->
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
        {#if widget.type === 'line'}
          <span class="flex items-center shrink-0 text-muted-foreground" title="Smoothing window (±)">
            <button
              class="hover:text-foreground disabled:opacity-30"
              disabled={(widget.smooth ?? 0) === 0}
              onclick={(e) => { e.stopPropagation(); setSmooth(widget, (widget.smooth ?? 0) - 1); }}
            >−</button>
            <span class="w-4 text-center tabular-nums">{widget.smooth ?? 0}</span>
            <button
              class="hover:text-foreground disabled:opacity-30"
              disabled={(widget.smooth ?? 0) >= 20}
              onclick={(e) => { e.stopPropagation(); setSmooth(widget, (widget.smooth ?? 0) + 1); }}
            >+</button>
          </span>
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

      <!-- Content(折叠时隐藏) -->
      {#if !isCollapsed}
        <div class="flex-1 min-h-0 p-2 {editing ? 'pointer-events-none' : ''}">
          <WidgetContent {widget} {runId} {metrics} data={boardsData} heightPx={contentHeight(effectiveH(widget))} {running} />
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

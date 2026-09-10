<script lang="ts">
  // ─── 看板网格:12 列 dense 布局;编辑态 = 拖拽换位 + 右下角手柄缩放 ───
  // 布局即数组顺序:卡片 span w 列 × h 行,grid-auto-flow: dense 自动填洞。
  import { GripHorizontal, Pencil, X } from 'lucide-svelte';
  import type { DashWidget } from '$lib/utils/dashboard';
  import { clampH, clampW, defaultWidgetTitle, minWOf } from '$lib/utils/dashboard';
  import { displayMetricName } from '$lib/utils/systemMetrics';
  import type { BoardsData, MetricSeries } from './boardsData';
  import WidgetContent from './WidgetContent.svelte';

  interface Props {
    widgets: DashWidget[];
    editing: boolean;
    runId: string;
    metrics: MetricSeries[];
    boardsData: BoardsData;
    /** 拖拽/缩放/删除等布局变更(鼠标抬起时提交,避免拖拽中重建图表) */
    onChange: (widgets: DashWidget[]) => void;
    /** 「编辑内容」按钮 → 父组件打开选择弹窗 */
    onEditContent: (widget: DashWidget) => void;
  }

  let { widgets, editing, runId, metrics, boardsData, onChange, onEditContent }: Props = $props();

  const ROW_PX = 44;
  const GAP_PX = 12;
  const HEADER_PX = 32;

  function contentHeight(w: number): number {
    return Math.max(80, w * ROW_PX + (w - 1) * GAP_PX - HEADER_PX - 16);
  }

  function titleOf(widget: DashWidget): string {
    return (
      widget.title ??
      defaultWidgetTitle(widget, (m) => displayMetricName(m.key, m.context) ?? `${m.key} [${m.context}]`)
    );
  }

  // ─── 拖拽换位:拖拽中只显示指示边框,落点提交(避免 dense 重排抖动图表) ───
  let dragId = $state<string | null>(null);
  let overIndex = $state(-1);

  function onDragStart(e: DragEvent, widget: DashWidget) {
    if (!editing) return;
    dragId = widget.id;
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', widget.id);
    }
  }
  function onDragOver(e: DragEvent, idx: number) {
    if (!editing || dragId === null || dragId === widgets[idx]?.id) return;
    e.preventDefault();
    overIndex = idx;
  }
  function onDrop(e: DragEvent, idx: number) {
    e.preventDefault();
    if (!editing || dragId === null || dragId === widgets[idx]?.id) {
      dragId = null;
      overIndex = -1;
      return;
    }
    const from = widgets.findIndex((w) => w.id === dragId);
    if (from >= 0) {
      const next = [...widgets];
      const [moved] = next.splice(from, 1);
      next.splice(idx, 0, moved);
      onChange(next);
    }
    dragId = null;
    overIndex = -1;
  }
  function onDragEnd() {
    dragId = null;
    overIndex = -1;
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
    const minW = minWOf(widget.type);
    const rect = gridEl?.getBoundingClientRect();
    const colStep = rect ? rect.width / 12 + GAP_PX : 80;

    const onMove = (ev: MouseEvent) => {
      const dw = Math.round((ev.clientX - startX) / colStep);
      const dh = Math.round((ev.clientY - startY) / (ROW_PX + GAP_PX));
      resizing = {
        id: widget.id,
        w: clampW(widget.type, Math.max(minW, startW + dw)),
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
  function commitRename() {
    if (renameId) {
      const t = renameValue.trim();
      onChange(
        widgets.map((w) =>
          w.id === renameId ? { ...w, title: t && t !== titleOf(w) ? t : undefined } : w
        )
      );
    }
    renameId = null;
  }

  let draggingAny = $derived(dragId !== null);
</script>

<div
  bind:this={gridEl}
  class="grid"
  style="grid-template-columns: repeat(12, minmax(0, 1fr)); grid-auto-rows: {ROW_PX}px; grid-auto-flow: dense; gap: {GAP_PX}px;"
>
  {#each widgets as widget, idx (widget.id)}
    <div
      class="border rounded-md overflow-hidden flex flex-col bg-card relative group/card {editing
        ? 'border-dashed cursor-grab'
        : 'border-border'} {dragId === widget.id ? 'opacity-40' : ''} {draggingAny && overIndex === idx && dragId !== widget.id
        ? 'ring-2 ring-primary/60'
        : ''}"
      style="grid-column: span {effectiveW(widget)}; grid-row: span {effectiveH(widget)};"
      draggable={editing}
      ondragstart={(e) => onDragStart(e, widget)}
      ondragover={(e) => onDragOver(e, idx)}
      ondrop={(e) => onDrop(e, idx)}
      ondragend={onDragEnd}
      role="{editing ? 'button' : 'presentation'}"
      tabindex={editing ? 0 : -1}
      onkeydown={(e) => {
        if (editing && (e.key === 'Enter' || e.key === ' ')) e.preventDefault();
      }}
    >
      <!-- Header -->
      <div class="flex items-center gap-1.5 px-2.5 border-b border-border bg-muted/20 shrink-0" style="height: {HEADER_PX}px;">
        {#if editing}
          <GripHorizontal size={13} class="text-muted-foreground shrink-0" />
        {/if}
        {#if renameId === widget.id}
          <input
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

      <!-- Content -->
      <div class="flex-1 min-h-0 p-2 {editing ? 'pointer-events-none' : ''}">
        <WidgetContent {widget} {runId} {metrics} data={boardsData} heightPx={contentHeight(effectiveH(widget)) - (resizing?.id === widget.id ? 8 : 0)} />
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
    </div>
  {/each}
</div>

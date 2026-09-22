<script lang="ts">
  // ─── 弹幕消息列表弹窗(手写遮罩+居中面板,对齐 WidgetPickerDialog 模式) ───
  // 列表用 flex-col-reverse + 数据倒序渲染:天然锚定底部(新消息在下),
  // 打开即贴底、新消息自动可见、加载更早不跳动——全程零滚动 JS / 零 $effect。
  import { X, ChevronUp } from 'lucide-svelte';
  import { danmakuStore, DANMAKU_COLOR_MAP } from '$lib/danmaku/danmakuStore.svelte';
  import DanmakuInputBar from './DanmakuInputBar.svelte';

  interface Props {
    onClose: () => void;
  }

  let { onClose }: Props = $props();

  function fmtTime(ts: number): string {
    return new Date(ts * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  /** 消息色 CSS('' → 空,由 class 走主题色) */
  function colorStyle(color?: string): string {
    const hex = color ? DANMAKU_COLOR_MAP[color as keyof typeof DANMAKU_COLOR_MAP] : '';
    return hex ? `color:${hex}` : '';
  }
</script>

<svelte:window
  onkeydown={(e) => {
    if (e.key === 'Escape') onClose();
  }}
/>

<!-- 遮罩:点击关闭 -->
<div class="fixed inset-0 bg-black/30 z-40" onclick={onClose} role="presentation"></div>

<div
  class="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[440px] max-w-[92vw] h-[min(560px,80vh)] bg-card border border-border rounded-xl shadow-xl flex flex-col"
  role="dialog"
  aria-label="弹幕列表"
  tabindex="-1"
>
  <!-- 头部 -->
  <div class="flex items-center gap-2 px-4 py-3 border-b border-border shrink-0">
    <span class="text-sm font-medium text-foreground">弹幕列表</span>
    <span class="text-xs text-muted-foreground">{danmakuStore.messages.length} 条</span>
    <div class="ml-auto flex items-center gap-2">
      {#if danmakuStore.hasOlder}
        <button
          class="text-xs text-muted-foreground hover:text-foreground flex items-center gap-0.5 disabled:opacity-40"
          disabled={danmakuStore.loadingOlder}
          onclick={() => danmakuStore.loadOlder()}
        >
          {#if danmakuStore.loadingOlder}
            加载中…
          {:else}
            <ChevronUp size={12} /> 加载更早
          {/if}
        </button>
      {/if}
      <button
        class="text-muted-foreground hover:text-foreground transition-colors"
        title="关闭(Esc)"
        onclick={onClose}
      >
        <X size={14} />
      </button>
    </div>
  </div>

  <!-- 消息列表:倒序渲染 + flex-col-reverse → 视觉顺序为正序、锚定底部 -->
  <div class="flex-1 overflow-y-auto flex flex-col-reverse px-4 py-3 gap-2.5 min-h-0">
    {#each [...danmakuStore.messages].reverse() as m (m.id)}
      <div class="text-sm leading-snug">
        <span class="text-primary text-xs font-medium mr-1.5">{m.nickname}</span>
        <span class="text-[10px] text-muted-foreground mr-1.5 tabular-nums">{fmtTime(m.created_at)}</span>
        <span class="break-words {m.color ? '' : 'text-foreground'}" style={colorStyle(m.color)}
          >{m.content}</span
        >
      </div>
    {/each}
    {#if danmakuStore.messages.length === 0}
      <div class="text-center text-xs text-muted-foreground py-8">还没有弹幕,来发第一条吧</div>
    {/if}
  </div>

  <!-- 底部发送条(与浮动面板共用) -->
  <div class="border-t border-border px-3 py-2.5 shrink-0">
    <DanmakuInputBar />
  </div>
</div>

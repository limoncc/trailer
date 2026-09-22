<script lang="ts">
  // ─── 弹幕消息列表弹窗(手写遮罩+居中面板,对齐 WidgetPickerDialog 模式) ───
  // 正序渲染(旧上新下)+ use: action 管滚动:挂载贴底、贴底时跟随新消息/删除;
  // 用户在上方浏览时的删除/加载更早交给浏览器原生滚动锚定(overflow-anchor)。
  // ⚠️ 勿改回 flex-col-reverse:其删除节点后的滚动坐标错乱会出现大块空白。
  import { X, ChevronUp, Trash2 } from 'lucide-svelte';
  import { danmakuStore, DANMAKU_COLOR_MAP } from '$lib/danmaku/danmakuStore.svelte';
  import { isShareView } from '$lib/utils/shareView';
  import DanmakuInputBar from './DanmakuInputBar.svelte';

  interface Props {
    onClose: () => void;
  }

  let { onClose }: Props = $props();

  // 删除入口:仅普通页(登录且能看到此页 = admin/owner;后端 require_run_write 把关)。
  // 分享页(token)= 访客只读,不显示;挂载时判定一次即可。
  const canDelete = !isShareView();

  function confirmDelete(id: number) {
    if (confirm('Delete this danmaku?')) void danmakuStore.removeMessage(id);
  }

  function fmtTime(ts: number): string {
    return new Date(ts * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  /** 消息色 CSS('' → 空,由 class 走主题色) */
  function colorStyle(color?: string): string {
    const hex = color ? DANMAKU_COLOR_MAP[color as keyof typeof DANMAKU_COLOR_MAP] : '';
    return hex ? `color:${hex}` : '';
  }

  /** 滚动 action:挂载贴底;messages 变化时原本贴底(<48px)则继续贴底 */
  function keepTail(el: HTMLElement, _msgs: unknown[]) {
    requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
    return {
      update() {
        const tail = el.scrollHeight - el.scrollTop - el.clientHeight;
        if (tail < 48) el.scrollTop = el.scrollHeight;
      }
    };
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
  aria-label="Danmaku list"
  tabindex="-1"
>
  <!-- 头部 -->
  <div class="flex items-center gap-2 px-4 py-3 border-b border-border shrink-0">
    <span class="text-sm font-medium text-foreground">Danmaku List</span>
    <span class="text-xs text-muted-foreground">{danmakuStore.messages.length} messages</span>
    <div class="ml-auto flex items-center gap-2">
      {#if danmakuStore.hasOlder}
        <button
          class="text-xs text-muted-foreground hover:text-foreground flex items-center gap-0.5 disabled:opacity-40"
          disabled={danmakuStore.loadingOlder}
          onclick={() => danmakuStore.loadOlder()}
        >
          {#if danmakuStore.loadingOlder}
            Loading…
          {:else}
            <ChevronUp size={12} /> Load earlier
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

  <!-- 消息列表:正序(旧上新下),滚动策略见 keepTail -->
  <div
    class="flex-1 overflow-y-auto flex flex-col px-4 py-3 gap-2.5 min-h-0"
    use:keepTail={danmakuStore.messages}
  >
    {#each danmakuStore.messages as m (m.id)}
      <div class="group/msg flex items-start gap-1 text-sm leading-snug">
        <span class="text-primary text-xs font-medium mr-1.5 mt-0.5 shrink-0">{m.nickname}</span>
        <span class="text-[10px] text-muted-foreground mr-1.5 mt-1 tabular-nums shrink-0"
          >{fmtTime(m.created_at)}</span
        >
        <span class="flex-1 break-words {m.color ? '' : 'text-foreground'}" style={colorStyle(m.color)}
          >{m.content}</span
        >
        {#if canDelete}
          <button
            class="mt-0.5 shrink-0 opacity-0 group-hover/msg:opacity-100 text-muted-foreground hover:text-destructive transition-opacity"
            title="Delete this danmaku"
            onclick={() => confirmDelete(m.id)}
          >
            <Trash2 size={12} />
          </button>
        {/if}
      </div>
    {/each}
    {#if danmakuStore.messages.length === 0}
      <div class="text-center text-xs text-muted-foreground py-8">No danmaku yet — send the first one!</div>
    {/if}
  </div>

  <!-- 底部发送条(与浮动面板共用) -->
  <div class="border-t border-border px-3 py-2.5 shrink-0">
    <DanmakuInputBar />
  </div>
</div>

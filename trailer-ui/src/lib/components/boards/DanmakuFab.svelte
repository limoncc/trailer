<script lang="ts">
  // ─── 弹幕浮动发送按钮:贴右缘半藏,鼠标靠近滑入;点开发送面板 ───
  // 面板内含发送条 + 「List」消息列表入口(列表唯一入口)。
  import { danmakuStore } from '$lib/danmaku/danmakuStore.svelte';
  import { Send, List, X } from 'lucide-svelte';
  import DanmakuInputBar from './DanmakuInputBar.svelte';

  let panelOpen = $state(false);

  function togglePanel() {
    panelOpen = !panelOpen;
  }

  function openList() {
    danmakuStore.openList();
    panelOpen = false;
  }
</script>

<!-- 容器整体 hover:把手平时右半藏屏外 translate-x-1/2,靠近滑入 -->
<div class="group fixed right-0 bottom-24 z-40 flex items-stretch gap-2">
  {#if panelOpen}
    <div
      class="w-80 max-w-[80vw] bg-card border border-border rounded-xl shadow-xl p-3 flex flex-col gap-2 animate-in slide-in-from-right fade-in duration-150"
      role="dialog"
      aria-label="发送弹幕"
      tabindex="-1"
    >
      <div class="flex items-center gap-2">
        <span class="text-sm font-medium text-foreground">DanMu</span>
        <span class="text-xs text-muted-foreground">发一条弹幕</span>
        <div class="ml-auto flex items-center gap-1.5">
          <button
            class="flex items-center gap-1 px-2 py-0.5 text-xs border border-border rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            title="Open message list"
            onclick={openList}
          >
            <List size={12} /> List
          </button>
          <button
            class="text-muted-foreground hover:text-foreground transition-colors"
            title="Close (Esc)"
            onclick={() => (panelOpen = false)}
          >
            <X size={14} />
          </button>
        </div>
      </div>
      <DanmakuInputBar />
    </div>
  {/if}

  <!-- 贴边把手:右半藏进屏外;hover 或面板打开时滑入 -->
  <button
    class="self-center flex items-center gap-1.5 pl-2 pr-3 py-2 rounded-l-full border border-r-0 border-border bg-card shadow-md text-muted-foreground hover:text-foreground transition-all duration-200 {panelOpen
      ? 'translate-x-0'
      : 'translate-x-[calc(50%-6px)] group-hover:translate-x-0'}"
    title="Send danmaku"
    aria-label="Send danmaku"
    onclick={togglePanel}
  >
    <Send size={15} />
  </button>
</div>

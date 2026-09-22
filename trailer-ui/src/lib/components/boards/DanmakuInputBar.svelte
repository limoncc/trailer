<script lang="ts">
  // ─── 弹幕发送条(共用):昵称 + 颜色色板 + 内容输入 + 发送 ───
  // FAB 浮动面板与消息列表弹窗共用;昵称 6 字、颜色为预设色 key。
  import {
    danmakuStore,
    DANMAKU_COLOR_MAP,
    MAX_CONTENT,
    MAX_NICKNAME,
    type DanmakuColor
  } from '$lib/danmaku/danmakuStore.svelte';
  import { Send, LoaderCircle } from 'lucide-svelte';

  let draft = $state('');

  const colorKeys = Object.keys(DANMAKU_COLOR_MAP) as DanmakuColor[];

  async function submit() {
    const text = draft.trim();
    if (!text) return;
    if (await danmakuStore.send(text)) draft = '';
  }

  /** 色块样式:默认色用主题文字色示意 */
  function swatchStyle(key: DanmakuColor): string {
    const hex = DANMAKU_COLOR_MAP[key];
    return hex ? `background:${hex}` : 'background:var(--foreground)';
  }
</script>

<div class="flex flex-col gap-1.5">
  <!-- 昵称 + 色板 -->
  <div class="flex items-center gap-2">
    <input
      value={danmakuStore.nickname}
      oninput={(e) => danmakuStore.setNickname(e.currentTarget.value)}
      placeholder="昵称(≤{MAX_NICKNAME}字)"
      maxlength={MAX_NICKNAME}
      aria-label="弹幕昵称"
      class="w-28 px-2 py-1.5 text-xs border border-border rounded bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
    />
    <div class="flex items-center gap-1" role="radiogroup" aria-label="弹幕颜色">
      {#each colorKeys as key (key)}
        <button
          type="button"
          role="radio"
          aria-checked={danmakuStore.color === key}
          aria-label={key === '' ? '主题色' : key}
          title={key === '' ? '主题色' : key}
          class="size-4 rounded-full border transition-transform hover:scale-110 {danmakuStore.color === key
            ? 'border-ring ring-2 ring-ring/50'
            : 'border-border'}"
          style={swatchStyle(key)}
          onclick={() => danmakuStore.setColor(key)}
        ></button>
      {/each}
    </div>
  </div>
  <!-- 内容 + 发送 -->
  <form
    class="flex items-center gap-1.5"
    onsubmit={(e) => {
      e.preventDefault();
      submit();
    }}
  >
    <input
      bind:value={draft}
      placeholder="发条弹幕…"
      maxlength={MAX_CONTENT}
      aria-label="弹幕内容"
      class="flex-1 min-w-0 px-2 py-1.5 text-xs border border-border rounded bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
    />
    <button
      type="submit"
      disabled={danmakuStore.sending || !draft.trim()}
      title="Send danmaku (Enter)"
      class="p-1.5 text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:pointer-events-none transition-colors"
    >
      {#if danmakuStore.sending}
        <LoaderCircle size={14} class="animate-spin" />
      {:else}
        <Send size={14} />
      {/if}
    </button>
  </form>

  {#if danmakuStore.error}
    <div class="text-xs text-destructive">{danmakuStore.error}</div>
  {/if}
</div>

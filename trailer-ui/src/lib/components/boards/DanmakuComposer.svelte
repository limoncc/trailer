<script lang="ts">
  // ─── 弹幕模式底部输入条:barrage 态常驻,发送走 danmakuStore(乐观插入) ───
  import { danmakuStore, MAX_CONTENT, MAX_NICKNAME } from '$lib/danmaku/danmakuStore.svelte';
  import { Send, LoaderCircle } from 'lucide-svelte';

  let draft = $state('');

  async function submit() {
    const text = draft.trim();
    if (!text) return;
    if (await danmakuStore.send(text)) draft = '';
  }
</script>

<form
  class="absolute bottom-3 left-1/2 -translate-x-1/2 z-30 flex items-center gap-1.5 px-2.5 py-2 bg-card/95 backdrop-blur border border-border rounded-lg shadow-lg"
  onsubmit={(e) => {
    e.preventDefault();
    submit();
  }}
>
  <input
    value={danmakuStore.nickname}
    oninput={(e) => danmakuStore.setNickname(e.currentTarget.value)}
    placeholder="昵称(可选)"
    maxlength={MAX_NICKNAME}
    aria-label="弹幕昵称"
    class="w-24 px-2 py-1.5 text-xs border border-border rounded bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
  />
  <input
    bind:value={draft}
    placeholder="发条弹幕…"
    maxlength={MAX_CONTENT}
    aria-label="弹幕内容"
    class="w-56 sm:w-72 px-2 py-1.5 text-xs border border-border rounded bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
  />
  <button
    type="submit"
    disabled={danmakuStore.sending || !draft.trim()}
    title="发送弹幕(Enter)"
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
  <div class="absolute bottom-16 left-1/2 -translate-x-1/2 z-30 text-xs text-destructive bg-card/95 border border-border rounded px-2 py-1">
    {danmakuStore.error}
  </div>
{/if}

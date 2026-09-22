<script lang="ts">
  // ─── 弹幕横飘层:无框纯文字两排(昵称左上小字 + 消息在下),起飞/归轨在 {@attach} 内完成 ───
  // 整层 pointer-events-none(v1 不做悬浮暂停/点击),不挡看板交互。
  import { danmakuStore, DANMAKU_COLOR_MAP, type DanmakuMsg } from '$lib/danmaku/danmakuStore.svelte';
  import { allocateTrack, completeTrack, createTracks, durationMs, TRACK_H } from '$lib/danmaku/tracks';

  /** 轨道状态仅被 attachment 动作读写,不需要响应性 */
  let tracks = createTracks();

  /** 文本估宽:14px 字号下 CJK ≈14px、ASCII ≈8px */
  function estimateWidth(text: string): number {
    let w = 0;
    for (const c of text) w += c.charCodeAt(0) > 255 ? 14 : 8;
    return w;
  }

  /** 消息色 CSS('' → 空,由 class 走主题色) */
  function colorStyle(color?: string): string {
    const hex = color ? DANMAKU_COLOR_MAP[color as keyof typeof DANMAKU_COLOR_MAP] : '';
    return hex ? `color:${hex}` : '';
  }

  /**
   * 起飞 action(use:):挂载执行一次,**参数变化不重调**——刻意选 action 而非
   * {@attach}:{@attach} 表达式捕获 m,flying 数组每次变化都会重跑全部元素,
   * 重复占轨 → 轨道秒满 → failed 风暴清空 flying、游标打转(弹幕中途消失、
   * 后面的弹幕永远出不来)。action 的"不响应"恰好是这里需要的语义。
   * 返回的 cleanup 仅在元素卸载时调用(归还轨道)。
   */
  function flyItem(el: HTMLElement, msg: DanmakuMsg): { destroy: () => void } | void {
    if (msg.fkey === undefined) return;
    const containerW = el.parentElement?.offsetWidth ?? 800;
    // 两排取较宽一行 + 少量留白
    const textW =
      Math.max(estimateWidth(msg.nickname), estimateWidth(msg.content)) + 24;
    const dur = durationMs(containerW, textW);
    const track = allocateTrack(tracks, performance.now(), dur);
    if (track < 0) {
      // 轨道全忙/冷却中:通知 store 游标回退,循环下一拍重出同一条(顺序不丢)
      danmakuStore.flyDone(msg.fkey, true);
      return;
    }
    el.style.setProperty('--dm-dist', `${containerW}px`);
    el.style.top = `${track * TRACK_H}px`;
    el.style.animation = `danmaku-x ${dur}ms linear forwards`;

    const onEnd = () => {
      completeTrack(tracks, track, performance.now());
      danmakuStore.flyDone(msg.fkey!);
    };
    el.addEventListener('animationend', onEnd, { once: true });
    return {
      destroy: () => {
        el.removeEventListener('animationend', onEnd);
        // 提前卸载(如切 off):留冷却防复用瞬间重叠
        completeTrack(tracks, track, performance.now());
      }
    };
  }
</script>

<div class="absolute inset-0 overflow-hidden pointer-events-none z-20">
  {#each danmakuStore.flying as m (m.fkey ?? m.id)}
    <span
      class="absolute left-full top-0 whitespace-nowrap flex flex-col leading-tight will-change-transform"
      use:flyItem={m}
    >
      <!-- 昵称:左上小字 -->
      <span
        class="text-[10px] opacity-80 font-medium {m.color ? '' : 'text-muted-foreground'}"
        style={colorStyle(m.color)}>{m.nickname}</span
      >
      <!-- 消息:下面大字 -->
      <span class="text-sm font-medium {m.color ? '' : 'text-foreground'}" style={colorStyle(m.color)}
        >{m.content}</span
      >
    </span>
  {/each}
</div>

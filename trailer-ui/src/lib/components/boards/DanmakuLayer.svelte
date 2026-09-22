<script lang="ts">
  // ─── 弹幕横飘层:只渲染在飞条目,起飞/归轨在 {@attach} 动作内完成(无 $effect) ───
  // 层与条目整体 pointer-events-none(v1 不做悬浮暂停/点击),不挡看板交互。
  import { danmakuStore, type DanmakuMsg } from '$lib/danmaku/danmakuStore.svelte';
  import { allocateTrack, completeTrack, createTracks, durationMs, TRACK_H } from '$lib/danmaku/tracks';

  /** 轨道状态仅被 attachment 动作读写,不需要响应性 */
  let tracks = createTracks();

  /** 文本估宽:14px 字号下 CJK ≈14px、ASCII ≈8px */
  function estimateWidth(text: string): number {
    let w = 0;
    for (const c of text) w += c.charCodeAt(0) > 255 ? 14 : 8;
    return w;
  }

  /** 元素挂载即起飞:现测容器宽、占轨、设动画;动画结束/提前卸载时归还轨道并通知 store */
  function startFly(el: HTMLElement, msg: DanmakuMsg) {
    if (msg.fkey === undefined) return;
    const containerW = el.parentElement?.offsetWidth ?? 800;
    const textW = estimateWidth(`${msg.nickname}${msg.content}`) + 48;
    const dur = durationMs(containerW, textW);
    const track = allocateTrack(tracks, performance.now(), dur);
    if (track < 0) {
      // 轨道全忙:丢弃该条(消息列表里仍有)
      danmakuStore.flyDone(msg.fkey);
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
    return () => {
      el.removeEventListener('animationend', onEnd);
      // 提前卸载(如切 off):留冷却防复用瞬间重叠
      completeTrack(tracks, track, performance.now());
    };
  }
</script>

<div class="absolute inset-0 overflow-hidden pointer-events-none z-20">
  {#each danmakuStore.flying as m (m.fkey ?? m.id)}
    <span
      class="absolute left-full top-0 whitespace-nowrap text-sm flex items-center gap-1.5 will-change-transform"
      {@attach (el) => startFly(el, m)}
    >
      <span class="text-primary font-medium">{m.nickname}</span>
      <span class="text-foreground bg-card/85 px-2 py-0.5 rounded border border-border/60 shadow-sm"
        >{m.content}</span
      >
    </span>
  {/each}
</div>

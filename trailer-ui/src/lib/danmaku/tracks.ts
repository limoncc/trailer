/**
 * 弹幕横飘轨道分配 — 纯函数,便于单测。
 * 每条弹幕占一条水平轨道,从上到下找第一条空闲的;全忙则丢弃(消息列表里仍有)。
 */

/** 轨道高度(px,含间距):两排布局(昵称小字+消息)需要更多行距 */
export const TRACK_H = 40;
/** 默认轨道数 */
export const TRACK_COUNT = 6;
/** 横飘速度(px/s):150 让单条过场约 7~8s,配合循环 1.5s 出幕基本不撞轨 */
export const SPEED_PX_PER_S = 150;
/** 轨道释放后的冷却(ms),防止同轨道两条紧贴出发 */
export const TRACK_GAP_MS = 400;

export interface TrackSlot {
  /** 该轨道最早可再次出发的时刻(performance.now() 基准) */
  freeAt: number;
}

export function createTracks(count = TRACK_COUNT): TrackSlot[] {
  return Array.from({ length: count }, () => ({ freeAt: 0 }));
}

/**
 * 申请一条轨道。
 * @param occupyMs 本条弹幕的动画时长(占轨时长),动画结束前轨道视为占用
 * @returns 轨道下标;全忙返回 -1(调用方丢弃该条)
 */
export function allocateTrack(tracks: TrackSlot[], now: number, occupyMs: number): number {
  for (let i = 0; i < tracks.length; i++) {
    if (now >= tracks[i].freeAt) {
      tracks[i].freeAt = now + Math.max(occupyMs, 0);
      return i;
    }
  }
  return -1;
}

/** 动画结束:轨道进入冷却,冷却结束后可复用。 */
export function completeTrack(
  tracks: TrackSlot[],
  idx: number,
  now: number,
  gapMs = TRACK_GAP_MS
): void {
  const t = tracks[idx];
  if (!t) return;
  t.freeAt = now + Math.max(gapMs, 0);
}

/** 弹幕动画时长 = (容器宽 + 文本宽) / 速度 */
export function durationMs(containerW: number, textW: number): number {
  return ((containerW + textW) / SPEED_PX_PER_S) * 1000;
}

import { describe, expect, it } from 'vitest';
import {
  allocateTrack,
  completeTrack,
  createTracks,
  durationMs,
  TRACK_COUNT
} from './tracks';

describe('danmaku tracks', () => {
  it('createTracks 默认 6 条且全部空闲', () => {
    const t = createTracks();
    expect(t).toHaveLength(TRACK_COUNT);
    expect(t.every((s) => s.freeAt === 0)).toBe(true);
  });

  it('空轨道优先取 0', () => {
    const t = createTracks();
    expect(allocateTrack(t, 1000, 5000)).toBe(0);
  });

  it('占用期内同轨道不可复用,顺延取下一条', () => {
    const t = createTracks();
    expect(allocateTrack(t, 1000, 5000)).toBe(0); // freeAt = 6000
    expect(allocateTrack(t, 1000, 5000)).toBe(1); // freeAt = 6000
    expect(allocateTrack(t, 5999, 100)).toBe(2); // 0、1 均占用中
    expect(allocateTrack(t, 6000, 100)).toBe(0); // 轨道 0 到 freeAt 复用
  });

  it('全忙返回 -1', () => {
    const t = createTracks();
    for (let i = 0; i < t.length; i++) allocateTrack(t, 0, 10_000);
    expect(allocateTrack(t, 5000, 100)).toBe(-1);
  });

  it('completeTrack 后进入冷却,冷却结束可再分配', () => {
    const t = createTracks();
    const idx = allocateTrack(t, 1000, 10_000);
    completeTrack(t, idx, 2000, 400);
    expect(allocateTrack(t, 2399, 100)).toBe(1); // 冷却中,取别的轨道
    expect(allocateTrack(t, 2400, 100)).toBe(0); // 冷却结束复用
  });

  it('completeTrack 对无效下标安全', () => {
    const t = createTracks();
    expect(() => completeTrack(t, 99, 0)).not.toThrow();
  });

  it('durationMs 随文本/容器宽度增长', () => {
    expect(durationMs(800, 100)).toBeGreaterThan(durationMs(800, 50));
    expect(durationMs(1000, 100)).toBeGreaterThan(durationMs(500, 100));
  });
});

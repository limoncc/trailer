import { describe, expect, it } from 'vitest';
import { pickLatestRun, runIdFromPath, type RunLite } from './projectsStore.svelte';

const run = (over: Partial<RunLite>): RunLite => ({
  id: 'run_x',
  name: 'n',
  project: 'p',
  created_at: 100,
  ...over,
});

describe('pickLatestRun', () => {
  it('空列表返回 null', () => {
    expect(pickLatestRun([])).toBeNull();
  });

  it('单元素返回自身', () => {
    const r = [run({ id: 'a' })];
    expect(pickLatestRun(r)?.id).toBe('a');
  });

  it('取 created_at 最大者(与传入顺序无关)', () => {
    const r = [
      run({ id: 'a', created_at: 100 }),
      run({ id: 'b', created_at: 300 }),
      run({ id: 'c', created_at: 200 }),
    ];
    expect(pickLatestRun(r)?.id).toBe('b');
  });

  it('并列时取先出现者(确定性)', () => {
    const r = [run({ id: 'first', created_at: 5 }), run({ id: 'second', created_at: 5 })];
    expect(pickLatestRun(r)?.id).toBe('first');
  });
});

describe('runIdFromPath', () => {
  it('匹配 /run/[id]', () => {
    expect(runIdFromPath('/run/run_1dfffb1d690b')).toBe('run_1dfffb1d690b');
  });

  it('忽略查询串与尾部斜杠', () => {
    expect(runIdFromPath('/run/abc/')).toBe('abc');
  });

  it('非 run 页返回 null', () => {
    expect(runIdFromPath('/')).toBeNull();
    expect(runIdFromPath('/explore')).toBeNull();
    expect(runIdFromPath('/explore/abc')).toBeNull();
    expect(runIdFromPath('/runs/abc')).toBeNull();
  });

  it('裸 /run 与 /run/ 返回 null', () => {
    expect(runIdFromPath('/run')).toBeNull();
    expect(runIdFromPath('/run/')).toBeNull();
  });
});

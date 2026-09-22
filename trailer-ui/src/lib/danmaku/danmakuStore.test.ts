import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CLIENT_KEY,
  MAX_MESSAGES,
  MODE_KEY,
  NICK_KEY,
  POLL_MS,
  DanmakuStore,
  type DanmakuMsg
} from './danmakuStore.svelte';

function msg(id: number, content = `m${id}`): DanmakuMsg {
  return { id, run_id: 'r1', nickname: 'n', content, created_at: 1 };
}

function okJson(data: unknown): Response {
  return new Response(JSON.stringify(data), { status: 200 });
}

/** flush 挂起的 microtask 链(fetch → json → merge) */
async function flush(times = 10) {
  for (let i = 0; i < times; i++) await Promise.resolve();
}

describe('DanmakuStore', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  // ── 三态与持久化 ──

  it('默认 off', () => {
    expect(new DanmakuStore().mode).toBe('off');
  });

  it('setMode 持久化;barrage/list 恢复,非法值回退 off', () => {
    const s = new DanmakuStore();
    s.setMode('barrage');
    expect(localStorage.getItem(MODE_KEY)).toBe('barrage');
    localStorage.setItem(MODE_KEY, 'barrage');
    expect(new DanmakuStore().mode).toBe('barrage');
    localStorage.setItem(MODE_KEY, 'yes');
    expect(new DanmakuStore().mode).toBe('off');
  });

  it('cycleMode: 关→横飘→列表→关', () => {
    const s = new DanmakuStore();
    s.cycleMode();
    expect(s.mode).toBe('barrage');
    s.cycleMode();
    expect(s.mode).toBe('list');
    s.cycleMode();
    expect(s.mode).toBe('off');
  });

  it('切到 off 清空 flying', () => {
    const s = new DanmakuStore();
    s.setMode('barrage');
    s.flying = [msg(1)];
    s.setMode('off');
    expect(s.flying).toHaveLength(0);
  });

  // ── 昵称 / client_id ──

  it('空昵称生成「访客xxxxxx」,自定义昵称持久化', () => {
    const s = new DanmakuStore();
    expect(s.effectiveNickname).toMatch(/^访客[0-9a-f]{6}$/);
    s.setNickname('张三');
    expect(s.effectiveNickname).toBe('张三');
    expect(localStorage.getItem(NICK_KEY)).toBe('张三');
    expect(new DanmakuStore().nickname).toBe('张三');
  });

  it('client_id 只生成一次(已有值不覆盖)', () => {
    new DanmakuStore();
    const first = localStorage.getItem(CLIENT_KEY);
    expect(first).toBeTruthy();
    new DanmakuStore();
    expect(localStorage.getItem(CLIENT_KEY)).toBe(first);
  });

  // ── attach / 轮询 ──

  it('attach 拉历史,detach 停轮询并清空', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okJson({ messages: [msg(1), msg(2)] }));
    vi.stubGlobal('fetch', fetchMock);
    const s = new DanmakuStore();
    s.setMode('barrage');
    s.attach('r1');
    await vi.waitFor(() => expect(s.messages).toHaveLength(2));
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/runs/r1/danmaku?limit=100');

    s.detach();
    expect(s.messages).toHaveLength(0);
    vi.useFakeTimers();
    const calls = fetchMock.mock.calls.length;
    await vi.advanceTimersByTimeAsync(POLL_MS * 3);
    expect(fetchMock.mock.calls.length).toBe(calls); // 已停表
  });

  it('off 模式 attach 不起轮询', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okJson({ messages: [] }));
    vi.stubGlobal('fetch', fetchMock);
    const s = new DanmakuStore();
    s.attach('r1');
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1)); // 仅首屏
    vi.useFakeTimers();
    await vi.advanceTimersByTimeAsync(POLL_MS * 3);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    s.detach();
  });

  it('轮询按 since_id 增量、按 id 去重,barrage 时进 flying', async () => {
    // 全程 fake timers:setInterval 必须在 fake 时钟上创建才能被接管
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(okJson({ messages: [msg(1)] }))
      .mockResolvedValue(okJson({ messages: [msg(1), msg(2)] })); // 重叠 + 新增
    vi.stubGlobal('fetch', fetchMock);
    const s = new DanmakuStore();
    s.setMode('barrage');
    s.attach('r1');
    await flush();
    expect(s.messages).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(fetchMock).toHaveBeenLastCalledWith('/api/v1/runs/r1/danmaku?since_id=1&limit=100');
    await flush();
    expect(s.messages.map((m) => m.id)).toEqual([1, 2]); // 去重
    expect(s.flying.map((m) => m.id)).toEqual([2]); // 仅新增进 flying
    s.detach();
  });

  it('flyDone 按 fkey 移除在飞条目,消息保留', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okJson({ messages: [msg(1)] }));
    vi.stubGlobal('fetch', fetchMock);
    const s = new DanmakuStore();
    s.setMode('barrage');
    s.attach('r1');
    await vi.waitFor(() => expect(s.messages).toHaveLength(1));
    s.flying = [{ ...msg(1), fkey: 7 }];
    s.flyDone(7);
    expect(s.flying).toHaveLength(0);
    expect(s.messages).toHaveLength(1);
    s.detach();
  });

  // ── send ──

  it('send 乐观插入,成功后用服务端 id 替换(无重复)', async () => {
    // 每次调用新建 Response(body 只能读一次)
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        return new Response(JSON.stringify({ id: 42, created_at: 9 }), { status: 201 });
      }
      return okJson({ messages: [] });
    });
    vi.stubGlobal('fetch', fetchMock);
    const s = new DanmakuStore();
    s.attach('r1');
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1)); // 首屏完成
    const ok = await s.send('你好');
    expect(ok).toBe(true);
    expect(s.messages).toHaveLength(1);
    expect(s.messages[0].id).toBe(42);
    expect(s.messages[0].temp).toBeUndefined();
    expect(s.error).toBe('');
    s.detach();
  });

  it('POST 未返回时轮询先带回:temp 折叠为真 id,flying 不重复起飞且 fkey 稳定', async () => {
    vi.useFakeTimers();
    let resolvePost!: (r: Response) => void;
    const postPromise = new Promise<Response>((r) => (resolvePost = r));
    const real = { id: 77, run_id: 'r1', nickname: 'n', content: 'hi', created_at: 5 };
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') return postPromise;
      if (String(url).includes('since_id')) return okJson({ messages: [real] });
      return okJson({ messages: [] }); // 首屏
    });
    vi.stubGlobal('fetch', fetchMock);
    const s = new DanmakuStore();
    s.setMode('barrage');
    s.nickname = 'n';
    s.attach('r1');
    await flush();
    const sendP = s.send('hi'); // temp 入队,POST 挂起
    await flush();
    expect(s.messages[0].temp).toBe(true);
    expect(s.flying).toHaveLength(1);
    const fkey = s.flying[0].fkey;
    await vi.advanceTimersByTimeAsync(POLL_MS); // 轮询先带回同一条 → 折叠
    await flush();
    expect(s.messages).toHaveLength(1);
    expect(s.messages[0].id).toBe(77);
    expect(s.flying).toHaveLength(1); // 不重复起飞
    expect(s.flying[0].fkey).toBe(fkey); // fkey 稳定,Layer 不会重建
    resolvePost(new Response(JSON.stringify(real), { status: 201 }));
    expect(await sendP).toBe(true);
    await flush();
    expect(s.messages).toHaveLength(1); // POST 响应再 merge 也不重复
    expect(s.flying).toHaveLength(1);
    expect(s.flying[0].fkey).toBe(fkey);
    s.detach();
  });

  it('429 回滚 temp 并提示限流', async () => {
    // GET 首屏正常,POST 才 429
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') return new Response('', { status: 429 });
      return okJson({ messages: [] });
    });
    vi.stubGlobal('fetch', fetchMock);
    const s = new DanmakuStore();
    s.setMode('barrage');
    s.attach('r1');
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1)); // 首屏完成,避免竞态覆盖 error
    const ok = await s.send('刷');
    expect(ok).toBe(false);
    expect(s.messages).toHaveLength(0);
    expect(s.flying).toHaveLength(0);
    expect(s.error).toContain('频繁');
    s.detach();
  });

  it('空内容不发送', async () => {
    const fetchMock = vi.fn(async () => okJson({ messages: [] }));
    vi.stubGlobal('fetch', fetchMock);
    const s = new DanmakuStore();
    s.attach('r1');
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1)); // 首屏
    const before = fetchMock.mock.calls.length;
    expect(await s.send('   ')).toBe(false);
    expect(fetchMock.mock.calls.length).toBe(before); // send 未发起新请求
    s.detach();
  });

  // ── 软上限 ──

  it('messages 超软上限丢最旧', async () => {
    const many = Array.from({ length: MAX_MESSAGES + 10 }, (_, i) => msg(i + 1));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okJson({ messages: many })));
    const s = new DanmakuStore();
    s.attach('r1');
    await vi.waitFor(() => expect(s.messages.length).toBe(MAX_MESSAGES));
    expect(s.messages[0].id).toBe(11); // 最旧的 10 条被丢
    s.detach();
  });

  // ── loadOlder ──

  it('loadOlder 向前翻页 prepend 且去重', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(okJson({ messages: [msg(3), msg(4)] }))
      .mockResolvedValueOnce(okJson({ messages: [msg(1), msg(2)] }));
    vi.stubGlobal('fetch', fetchMock);
    const s = new DanmakuStore();
    s.attach('r1');
    await vi.waitFor(() => expect(s.messages).toHaveLength(2));
    await s.loadOlder();
    expect(fetchMock).toHaveBeenLastCalledWith('/api/v1/runs/r1/danmaku?before_id=3&limit=50');
    expect(s.messages.map((m) => m.id)).toEqual([1, 2, 3, 4]);
    s.detach();
  });
});

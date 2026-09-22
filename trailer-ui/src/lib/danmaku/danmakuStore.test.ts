import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CLIENT_KEY,
  LOOP_INTERVAL_MS,
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
    vi.resetModules();
  });

  // ── Danmu 三态(off/live/loop)与列表浮层 ──

  it('默认 off + listClosed', () => {
    const s = new DanmakuStore();
    expect(s.playMode).toBe('off');
    expect(s.listOpen).toBe(false);
  });

  it('cyclePlayMode 循环 off→live→loop→off 并持久化;旧值迁移', () => {
    const s = new DanmakuStore();
    s.cyclePlayMode();
    expect(s.playMode).toBe('live');
    expect(localStorage.getItem(MODE_KEY)).toBe('live');
    s.cyclePlayMode();
    expect(s.playMode).toBe('loop');
    expect(localStorage.getItem(MODE_KEY)).toBe('loop');
    s.cyclePlayMode();
    expect(s.playMode).toBe('off');
    expect(localStorage.getItem(MODE_KEY)).toBe('off');

    // 恢复
    localStorage.setItem(MODE_KEY, 'loop');
    expect(new DanmakuStore().playMode).toBe('loop');
    // 旧值迁移:barrage→live;list/非法→off
    localStorage.setItem(MODE_KEY, 'barrage');
    expect(new DanmakuStore().playMode).toBe('live');
    localStorage.setItem(MODE_KEY, 'list');
    expect(new DanmakuStore().playMode).toBe('off');
    localStorage.setItem(MODE_KEY, 'yes');
    expect(new DanmakuStore().playMode).toBe('off');
  });

  it('分享链接默认进入 loop(展示模式),不读本地偏好;清 token 恢复偏好', () => {
    localStorage.setItem(MODE_KEY, 'off');
    const url = new URL(window.location.href);
    url.search = '?token=abc123';
    window.history.replaceState({}, '', url);
    try {
      expect(new DanmakuStore().playMode).toBe('loop');
    } finally {
      window.history.replaceState({}, '', '/');
    }
    expect(new DanmakuStore().playMode).toBe('off'); // 普通页仍读偏好
  });

  it('回到 off 清空 flying;listOpen 独立且不持久化', () => {
    const s = new DanmakuStore();
    s.cyclePlayMode(); // live
    s.flying = [msg(1)];
    s.listOpen = true;
    s.cyclePlayMode(); // loop
    s.cyclePlayMode(); // off
    expect(s.playMode).toBe('off');
    expect(s.flying).toHaveLength(0);
    expect(localStorage.getItem(MODE_KEY)).toBe('off');
    // listOpen 是会话态,不写 localStorage(MODE_KEY 只记播放模式)
    s.openList();
    expect(s.listOpen).toBe(true);
    expect(localStorage.getItem(MODE_KEY)).toBe('off');
    s.closeList();
    expect(s.listOpen).toBe(false);
  });

  it('loop:串行按时间序出幕(每拍一条),正常飞完不回补,轨道失败回退重出同条', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue(okJson({ messages: [msg(1), msg(2)] }));
    vi.stubGlobal('fetch', fetchMock);
    const s = new DanmakuStore();
    s.attach('r1');
    await flush();
    s.cyclePlayMode(); // live
    await flush();
    s.cyclePlayMode(); // loop:首条立即出
    expect(s.flying.map((m) => m.id)).toEqual([1]);
    await vi.advanceTimersByTimeAsync(LOOP_INTERVAL_MS);
    expect(s.flying.map((m) => m.id)).toEqual([1, 2]); // 第二拍出第 2 条
    await vi.advanceTimersByTimeAsync(LOOP_INTERVAL_MS);
    expect(s.flying.map((m) => m.id)).toEqual([1, 2, 1]); // 游标绕回,顺序严格

    // 正常飞完:只移除不回补(节奏由出幕定时器驱动)
    s.flyDone(s.flying[0].fkey!);
    expect(s.flying.map((m) => m.id)).toEqual([2, 1]);

    // 轨道失败(刚出的最后一条):游标回退,下一拍重出同一条,顺序不丢
    const last = s.flying[s.flying.length - 1];
    s.flyDone(last.fkey!, true);
    await vi.advanceTimersByTimeAsync(LOOP_INTERVAL_MS);
    expect(s.flying[s.flying.length - 1].id).toBe(last.id);

    s.detach();
  });

  it('loop:空源时不飞,轮询到新消息后下一拍出幕', async () => {
    vi.useFakeTimers();
    let pollN = 0;
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).includes('since_id')) {
        // 第 1 次 = 进模式的 silent poll(空);之后 = 正式轮询带回 msg5
        pollN += 1;
        return pollN === 1 ? okJson({ messages: [] }) : okJson({ messages: [msg(5)] });
      }
      return okJson({ messages: [] }); // 首屏空
    });
    vi.stubGlobal('fetch', fetchMock);
    const s = new DanmakuStore();
    s.attach('r1');
    await flush();
    s.cyclePlayMode(); // live(silent 空)
    s.cyclePlayMode(); // loop:源空 → 本拍跳过
    await flush();
    expect(s.flying).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(POLL_MS); // 正式轮询带回 msg5(只进源)
    await flush();
    expect(s.messages.map((m) => m.id)).toEqual([5]);
    await vi.advanceTimersByTimeAsync(LOOP_INTERVAL_MS); // 出幕定时器下一拍
    expect(s.flying.map((m) => m.id)).toEqual([5]);
    s.detach();
  });

  // ── 昵称 / 颜色 / client_id ──

  it('空昵称且未登录 →「访客xxxxxx」;自定义昵称持久化且截 6 字', () => {
    // 真实 projectsStore 默认 _user=null(未登录)
    const s = new DanmakuStore();
    expect(s.effectiveNickname).toMatch(/^访客[0-9a-f]{6}$/);
    s.setNickname('张三丰的昵称很长');
    expect(s.effectiveNickname).toBe('张三丰的昵称'); // 截 6 字
    expect(localStorage.getItem(NICK_KEY)).toBe('张三丰的昵称很长');
    expect(new DanmakuStore().nickname).toBe('张三丰的昵称很长');
  });

  it('登录用户无自定义昵称时默认用户名(截 6 字)', async () => {
    // getUser 在构造 effectiveNickname 时读取;mock 需在 import 前生效 → 用动态 import
    vi.resetModules();
    vi.doMock('$lib/projectsStore.svelte', () => ({
      getUser: () => ({ id: 1, username: 'limoncc', role: 'admin' })
    }));
    const { DanmakuStore: S } = await import('./danmakuStore.svelte');
    const s = new S();
    expect(s.effectiveNickname).toBe('limoncc'.slice(0, 6)); // 'limonc'
    s.setNickname('自己');
    expect(s.effectiveNickname).toBe('自己');
  });

  it('client_id 只生成一次(已有值不覆盖)', () => {
    new DanmakuStore();
    const first = localStorage.getItem(CLIENT_KEY);
    expect(first).toBeTruthy();
    new DanmakuStore();
    expect(localStorage.getItem(CLIENT_KEY)).toBe(first);
  });

  it('color 状态可设置,默认空(主题色)', () => {
    const s = new DanmakuStore();
    expect(s.color).toBe('');
    s.setColor('red');
    expect(s.color).toBe('red');
  });

  // ── attach / 轮询 ──

  it('attach 拉历史,detach 停轮询并清空(off 态不起表)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okJson({ messages: [msg(1), msg(2)] }));
    vi.stubGlobal('fetch', fetchMock);
    const s = new DanmakuStore();
    s.attach('r1');
    await vi.waitFor(() => expect(s.messages).toHaveLength(2));
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/runs/r1/danmaku?limit=100');

    s.detach();
    expect(s.messages).toHaveLength(0);
    vi.useFakeTimers();
    const calls = fetchMock.mock.calls.length;
    await vi.advanceTimersByTimeAsync(POLL_MS * 3);
    expect(fetchMock.mock.calls.length).toBe(calls); // off 态 + 已卸载,无轮询
  });

  it('playMode 非 off 或 listOpen 任一开启即轮询;都关则停', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okJson({ messages: [] }));
    vi.stubGlobal('fetch', fetchMock);
    const s = new DanmakuStore();
    s.attach('r1');
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1)); // 首屏
    vi.useFakeTimers();
    await vi.advanceTimersByTimeAsync(POLL_MS * 2);
    expect(fetchMock).toHaveBeenCalledTimes(1); // 双关不轮询

    s.openList();
    await flush();
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(fetchMock.mock.calls.length).toBeGreaterThan(1); // 开列表起表

    const during = fetchMock.mock.calls.length;
    s.closeList();
    await vi.advanceTimersByTimeAsync(POLL_MS * 3);
    expect(fetchMock.mock.calls.length).toBe(during); // 关列表停表
    s.detach();
  });

  it('轮询按 since_id 增量、按 id 去重;开闸 silent poll 吞积压不飞,正式轮询的新消息才飞', async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(okJson({ messages: [msg(1)] })) // 首屏
      .mockResolvedValueOnce(okJson({ messages: [msg(1), msg(2)] })) // toggle 时 silent 补积压
      .mockResolvedValue(okJson({ messages: [msg(1), msg(2), msg(3)] })); // 正式轮询带新 3
    vi.stubGlobal('fetch', fetchMock);
    const s = new DanmakuStore();
    s.attach('r1');
    await flush();
    expect(s.messages).toHaveLength(1);
    s.cyclePlayMode(); // live:静默 poll 补积压(2 进列表但不飞)
    await flush();
    expect(s.messages.map((m) => m.id)).toEqual([1, 2]);
    expect(s.flying).toHaveLength(0); // 积压不飞
    await vi.advanceTimersByTimeAsync(POLL_MS); // 正式轮询
    expect(fetchMock).toHaveBeenLastCalledWith('/api/v1/runs/r1/danmaku?since_id=2&limit=100');
    await flush();
    expect(s.messages.map((m) => m.id)).toEqual([1, 2, 3]); // 去重合并
    expect(s.flying.map((m) => m.id)).toEqual([3]); // 仅正式轮询的新消息进 flying
    s.detach();
  });

  it('flyDone 按 fkey 移除在飞条目,消息保留', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okJson({ messages: [msg(1)] }));
    vi.stubGlobal('fetch', fetchMock);
    const s = new DanmakuStore();
    s.attach('r1');
    await vi.waitFor(() => expect(s.messages).toHaveLength(1));
    s.flying = [{ ...msg(1), fkey: 7 }];
    s.flyDone(7);
    expect(s.flying).toHaveLength(0);
    expect(s.messages).toHaveLength(1);
    s.detach();
  });

  // ── send ──

  it('send 乐观插入(带 color),成功后折叠为服务端 id', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        const body = JSON.parse(String(init.body));
        expect(body.color).toBe('red');
        expect(body.nickname).toBe('访客'); // 截断后的有效昵称
        return new Response(JSON.stringify({ id: 42, created_at: 9 }), { status: 201 });
      }
      return okJson({ messages: [] });
    });
    vi.stubGlobal('fetch', fetchMock);
    const s = new DanmakuStore();
    s.setNickname('访客');
    s.setColor('red');
    s.attach('r1');
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const ok = await s.send('你好');
    expect(ok).toBe(true);
    expect(s.messages).toHaveLength(1);
    expect(s.messages[0].id).toBe(42);
    expect(s.messages[0].color).toBe('red');
    expect(s.messages[0].temp).toBeUndefined();
    expect(s.error).toBe('');
    s.detach();
  });

  it('429 回滚 temp 并提示限流', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') return new Response('', { status: 429 });
      return okJson({ messages: [] });
    });
    vi.stubGlobal('fetch', fetchMock);
    const s = new DanmakuStore();
    s.cyclePlayMode(); // live:optimistic 推 flying,429 后应回滚
    s.attach('r1');
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const ok = await s.send('刷');
    expect(ok).toBe(false);
    expect(s.messages).toHaveLength(0);
    expect(s.flying).toHaveLength(0);
    expect(s.error).toContain('frequent');
    s.detach();
  });

  it('空内容不发送', async () => {
    const fetchMock = vi.fn(async () => okJson({ messages: [] }));
    vi.stubGlobal('fetch', fetchMock);
    const s = new DanmakuStore();
    s.attach('r1');
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const before = fetchMock.mock.calls.length;
    expect(await s.send('   ')).toBe(false);
    expect(fetchMock.mock.calls.length).toBe(before);
    s.detach();
  });

  it('POST 未返回时轮询先带回:temp 折叠为真 id,flying 不重复起飞且 fkey 稳定', async () => {
    vi.useFakeTimers();
    let resolvePost!: (r: Response) => void;
    const postPromise = new Promise<Response>((r) => (resolvePost = r));
    const real = { id: 77, run_id: 'r1', nickname: 'n', content: 'hi', created_at: 5 };
    let pollCount = 0;
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') return postPromise;
      if (String(url).includes('since_id')) {
        // 第 1 次 = toggle 的 silent poll(空);之后 = 正式轮询带回 real
        pollCount += 1;
        return pollCount === 1 ? okJson({ messages: [] }) : okJson({ messages: [real] });
      }
      return okJson({ messages: [] }); // 首屏
    });
    vi.stubGlobal('fetch', fetchMock);
    const s = new DanmakuStore();
    s.nickname = 'n';
    s.attach('r1');
    await flush();
    s.cyclePlayMode(); // live:静默 poll 返回空,不抢先合并
    await flush();
    const sendP = s.send('hi'); // temp 入队(playMode 非 off → 进 flying),POST 挂起
    await flush();
    expect(s.messages.some((m) => m.temp)).toBe(true);
    expect(s.flying).toHaveLength(1);
    const fkey = s.flying[0].fkey;
    await vi.advanceTimersByTimeAsync(POLL_MS); // 轮询先带回同一条 → 折叠
    await flush();
    expect(s.messages).toHaveLength(1);
    expect(s.messages[0].id).toBe(77);
    expect(s.flying).toHaveLength(1);
    expect(s.flying[0].fkey).toBe(fkey);
    resolvePost(new Response(JSON.stringify(real), { status: 201 }));
    expect(await sendP).toBe(true);
    await flush();
    expect(s.messages).toHaveLength(1);
    expect(s.flying).toHaveLength(1);
    expect(s.flying[0].fkey).toBe(fkey);
    s.detach();
  });

  // ── 删除 ──

  it('removeMessage 成功后本地移除(含在飞条目)', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'DELETE') return new Response('', { status: 200 });
      return okJson({ messages: [msg(1), msg(2)] });
    });
    vi.stubGlobal('fetch', fetchMock);
    const s = new DanmakuStore();
    s.attach('r1');
    await vi.waitFor(() => expect(s.messages).toHaveLength(2));
    s.flying = [{ ...msg(1), fkey: 9 }];
    const ok = await s.removeMessage(1);
    expect(ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/runs/r1/danmaku/1', { method: 'DELETE' });
    expect(s.messages.map((m) => m.id)).toEqual([2]);
    expect(s.flying).toHaveLength(0); // 在飞的同步移除
    s.detach();
  });

  it('removeMessage 失败保留本地并提示', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'DELETE') return new Response('', { status: 403 });
      return okJson({ messages: [msg(1)] });
    });
    vi.stubGlobal('fetch', fetchMock);
    const s = new DanmakuStore();
    s.attach('r1');
    await vi.waitFor(() => expect(s.messages).toHaveLength(1));
    const ok = await s.removeMessage(1);
    expect(ok).toBe(false);
    expect(s.messages).toHaveLength(1);
    expect(s.error).toContain('403');
    s.detach();
  });

  // ── 软上限 / 翻页 ──

  it('messages 超软上限丢最旧', async () => {
    const many = Array.from({ length: MAX_MESSAGES + 10 }, (_, i) => msg(i + 1));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okJson({ messages: many })));
    const s = new DanmakuStore();
    s.attach('r1');
    await vi.waitFor(() => expect(s.messages.length).toBe(MAX_MESSAGES));
    expect(s.messages[0].id).toBe(11);
    s.detach();
  });

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

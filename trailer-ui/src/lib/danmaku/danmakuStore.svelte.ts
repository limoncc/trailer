/**
 * Boards 弹幕 store — 模块级单例(对齐 sidebar-state/projectsStore 的 runes 单例模式)。
 *
 * 两个独立状态:
 * - playMode: 工具栏 Danmu 三态循环 off(关) → live(实时:只飞新到) → loop(循环:存量反复飞) → off
 * - listOpen: 消息列表(仅从浮动面板进入),不持久化
 * 数据 per-run:attach 拉最近历史,开启(playMode !== 'off' || listOpen)时每 2s 轮询 since_id 增量。
 * 发送走全局 fetch(authFetch 已 patch:登录自动 Bearer、分享页自动附 ?token=)。
 */
import { getUser } from '$lib/projectsStore.svelte';
import { isShareView } from '$lib/utils/shareView';

/** 弹幕播放三态 */
export type DanmakuPlayMode = 'off' | 'live' | 'loop';

export const MODE_KEY = 'trailer-danmaku-mode';
export const NICK_KEY = 'trailer-danmaku-nickname';
export const CLIENT_KEY = 'trailer-danmaku-client-id';

/** 客户端软上限:服务端仍全量保存 */
export const MAX_MESSAGES = 1000;
/** 首屏/翻页条数 */
export const HISTORY_LIMIT = 100;
export const PAGE_LIMIT = 50;
export const POLL_MS = 2000;
export const MAX_CONTENT = 200;
/** 昵称上限(服务端同为 6 字) */
export const MAX_NICKNAME = 6;
/** 循环模式出幕间隔(ms):一条一条按时间先后出,配合 SPEED 150px/s 基本不撞轨 */
export const LOOP_INTERVAL_MS = 1500;
/** 循环在飞软上限:挤不下时跳过本拍(游标不推进,顺序不丢,下拍重试) */
export const LOOP_MAX_FLYING = 8;

/** 预设色 key → CSS 色值('' = 跟随主题文字色);与服务端白名单一致 */
export const DANMAKU_COLOR_MAP = {
  '': '',
  red: '#ef4444',
  orange: '#f97316',
  yellow: '#eab308',
  green: '#22c55e',
  cyan: '#06b6d4',
  blue: '#3b82f6',
  purple: '#a855f7'
} as const;
export type DanmakuColor = keyof typeof DANMAKU_COLOR_MAP;

export interface DanmakuMsg {
  /** 服务端自增 id;乐观消息用负数 temp id */
  id: number;
  run_id: string;
  nickname: string;
  content: string;
  /** 预设色 key,'' = 主题色 */
  color?: string;
  created_at: number;
  temp?: boolean;
  /** 推入 flying 时分配的本地序号:Layer 的去重键,id 落定/替换后保持稳定 */
  fkey?: number;
}

function readPlayMode(): DanmakuPlayMode {
  if (typeof window === 'undefined') return 'off';
  // 分享链接:自动进入循环播放(展示模式),不读本地偏好;
  // 访客本次会话仍可手动切换,下次打开分享链接恢复 loop
  if (isShareView()) return 'loop';
  if (typeof localStorage === 'undefined') return 'off';
  try {
    const v = localStorage.getItem(MODE_KEY);
    if (v === 'live' || v === 'loop') return v;
    if (v === 'barrage') return 'live'; // 旧值:'barrage' 即实时
    return 'off'; // 含旧 'list'(列表现为独立浮层)与非法值
  } catch {
    return 'off';
  }
}

function readStr(key: string): string {
  if (typeof localStorage === 'undefined') return '';
  try {
    return localStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
}

function writeStr(key: string, value: string) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

function randomId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `dm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export class DanmakuStore {
  /** 工具栏 Danmu 三态:off 关 / live 实时 / loop 循环 */
  playMode = $state<DanmakuPlayMode>(readPlayMode());
  /** 消息列表浮层(仅浮动面板进入) */
  listOpen = $state(false);
  nickname = $state(readStr(NICK_KEY));
  /** 当前发送用的预设色 key('' = 主题色) */
  color = $state<DanmakuColor>('');
  /** 消息全集(软上限 MAX_MESSAGES) */
  messages = $state<DanmakuMsg[]>([]);
  /** 当前在飞(仅 barrage 层渲染) */
  flying = $state<DanmakuMsg[]>([]);
  sending = $state(false);
  error = $state('');
  loadingOlder = $state(false);
  hasOlder = $state(false);

  #runId: string | null = null;
  #timer: ReturnType<typeof setInterval> | null = null;
  /** 循环出幕定时器(串行:每拍一条) */
  #loopTimer: ReturnType<typeof setInterval> | null = null;
  #clientId = readStr(CLIENT_KEY);
  #tempSeq = 0;
  #fkeySeq = 0;
  /** 循环播放游标(单调递增,消费时对源长度取模;失败回退 --) */
  #loopCursor = 0;

  constructor() {
    if (!this.#clientId) {
      this.#clientId = randomId();
      writeStr(CLIENT_KEY, this.#clientId);
    }
  }

  /**
   * 发送昵称:自定义 > 登录用户名(截 6 字)>「访客xxxxxx」。
   * 登录用户来自 projectsStore(layout 登录时 setUser)。
   */
  get effectiveNickname(): string {
    const nick = this.nickname.trim();
    if (nick) return nick.slice(0, MAX_NICKNAME);
    const username = getUser()?.username?.trim();
    if (username) return username.slice(0, MAX_NICKNAME);
    return `访客${randomId().replace(/-/g, '').slice(0, 6)}`;
  }

  setNickname(v: string) {
    this.nickname = v;
    writeStr(NICK_KEY, v);
  }

  setColor(v: DanmakuColor) {
    this.color = v;
  }

  /** 工具栏 Danmu 三态循环:off → live → loop → off */
  cyclePlayMode() {
    this.setPlayMode(
      this.playMode === 'off' ? 'live' : this.playMode === 'live' ? 'loop' : 'off'
    );
  }

  setPlayMode(m: DanmakuPlayMode) {
    const prev = this.playMode;
    if (m === prev) return;
    this.playMode = m;
    writeStr(MODE_KEY, m);
    // 离开 off 先静默补一次增量:live 防积压齐飞,loop 刷新循环源
    if (prev === 'off' && m !== 'off') void this.#poll(true);
    if (m === 'off') {
      this.flying = [];
      this.#loopCursor = 0;
    }
    this.#stopLoopTimer();
    if (m === 'loop') {
      this.#pushLoopOne(); // 首条立即出
      this.#startLoopTimer();
    }
    this.#syncPolling();
  }

  /**
   * 循环出一幕:严格按消息时间先后(id 升序)取游标下一条。
   * 在飞挤满时跳过本拍(游标不动 → 顺序不丢,下拍重试);空源等轮询补源。
   */
  #pushLoopOne() {
    if (this.playMode !== 'loop') return;
    if (this.flying.length >= LOOP_MAX_FLYING) return;
    const real = this.messages.filter((m) => m.id > 0);
    if (!real.length) return;
    const m = real[this.#loopCursor % real.length];
    this.#loopCursor += 1;
    this.flying = [...this.flying, ...this.#toFlying([m])];
  }

  #startLoopTimer() {
    if (this.#loopTimer) return;
    this.#loopTimer = setInterval(() => this.#pushLoopOne(), LOOP_INTERVAL_MS);
  }

  #stopLoopTimer() {
    if (this.#loopTimer) clearInterval(this.#loopTimer);
    this.#loopTimer = null;
  }

  /** 消息列表(仅浮动面板进入):打开先静默补积压,避免旧消息刷屏列表滚动位 */
  openList() {
    if (this.listOpen) return;
    this.listOpen = true;
    void this.#poll(true);
    this.#syncPolling();
  }

  closeList() {
    if (!this.listOpen) return;
    this.listOpen = false;
    this.#syncPolling();
  }

  attach(runId: string) {
    if (this.#runId === runId) return;
    this.#runId = runId;
    this.messages = [];
    this.flying = [];
    this.hasOlder = false;
    this.error = '';
    this.#loopCursor = 0;
    void this.#loadLatest();
    if (this.playMode === 'loop') this.#startLoopTimer(); // 恢复页即 loop:定时器从源出幕
    this.#syncPolling();
  }

  detach() {
    this.#runId = null;
    this.#stopPolling();
    this.#stopLoopTimer();
    this.messages = [];
    this.flying = [];
    this.hasOlder = false;
    this.#loopCursor = 0;
  }

  /**
   * 动画结束由 Layer 按 fkey 回调移除(messages 保留)。
   * failed=true 表示轨道分配失败:游标回退,循环下一拍重出同一条(顺序不丢)。
   * 正常飞完不回退——循环节奏由出幕定时器驱动,不在此补位(避免同步风暴)。
   */
  flyDone(fkey: number, failed = false) {
    this.flying = this.flying.filter((m) => m.fkey !== fkey);
    if (failed && this.playMode === 'loop') {
      this.#loopCursor = Math.max(0, this.#loopCursor - 1);
    }
  }

  /** 推入在飞队列并分配 fkey(Layer 以此去重,跨 id 替换稳定) */
  #toFlying(msgs: DanmakuMsg[]): DanmakuMsg[] {
    return msgs.map((m) => ({ ...m, fkey: ++this.#fkeySeq }));
  }

  #syncPolling() {
    this.#stopPolling();
    if (this.#runId && (this.playMode !== 'off' || this.listOpen)) {
      this.#timer = setInterval(() => void this.#poll(false), POLL_MS);
    }
  }

  #stopPolling() {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
  }

  #lastId(): number {
    return this.messages.reduce((mx, m) => (m.id > mx ? m.id : mx), 0);
  }

  #firstId(): number {
    const pos = this.messages.filter((m) => m.id > 0);
    return pos.length ? Math.min(...pos.map((m) => m.id)) : 0;
  }

  async #fetchMessages(params: string): Promise<DanmakuMsg[]> {
    const res = await fetch(`/api/v1/runs/${this.#runId}/danmaku${params}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const list: DanmakuMsg[] = data.messages ?? [];
    return list.filter((m) => typeof m.id === 'number');
  }

  /**
   * 按 id 升序并入,返回真正新增的条目;超软上限丢最旧。
   * temp 折叠:轮询/POST 响应带回与乐观消息同昵称同内容的真条目时,
   * 用真 id 替换 temp(messages + flying,fkey 不变——Layer 不会重复起飞)。
   */
  #merge(fresh: DanmakuMsg[]): DanmakuMsg[] {
    if (!fresh.length) return [];
    for (const f of fresh) {
      const ti = this.messages.find(
        (m) => m.temp && m.content === f.content && m.nickname === f.nickname
      );
      if (ti) {
        this.messages = this.messages.map((m) =>
          m.id === ti.id ? { ...f, temp: undefined, fkey: m.fkey } : m
        );
        this.flying = this.flying.map((m) =>
          m.id === ti.id ? { ...m, id: f.id, temp: undefined, created_at: f.created_at } : m
        );
      }
    }
    const known = new Set(this.messages.map((m) => m.id));
    const added = fresh.filter((m) => !known.has(m.id));
    if (!added.length) return [];
    let next = [...this.messages, ...added].sort((a, b) => a.id - b.id);
    if (next.length > MAX_MESSAGES) next = next.slice(next.length - MAX_MESSAGES);
    this.messages = next;
    if (this.#firstId() > 1) this.hasOlder = true;
    return added;
  }

  async #loadLatest() {
    try {
      const msgs = await this.#fetchMessages(`?limit=${HISTORY_LIMIT}`);
      // 历史只进列表:live 不飞(避免开启瞬间全飞);loop 由定时器从源串行出幕
      this.#merge(msgs);
      if (msgs.length === HISTORY_LIMIT) this.hasOlder = true;
    } catch (e) {
      this.error = e instanceof Error ? e.message : 'Failed to load danmaku';
    }
  }

  async #poll(silent: boolean) {
    if (!this.#runId) return;
    try {
      const fresh = await this.#fetchMessages(`?since_id=${this.#lastId()}&limit=100`);
      const added = this.#merge(fresh);
      if (silent || !added.length) return;
      if (this.playMode === 'live') {
        // 实时:新消息立即起飞(loop 的循环源同步更新,由出幕定时器按序播)
        this.flying = [...this.flying, ...this.#toFlying(added)];
      }
    } catch {
      /* 轮询静默失败,下一拍重试 */
    }
  }

  /**
   * 删除一条弹幕(仅 admin/owner 会看到入口;后端 require_run_write 把关)。
   * 成功后本地同步移除(含在飞条目 → Layer 卸载归轨);游标不动——
   * 删除低频,% len 在源变化后顺序轻微偏一格可接受。
   */
  async removeMessage(id: number): Promise<boolean> {
    if (!this.#runId || id <= 0) return false;
    try {
      const res = await fetch(`/api/v1/runs/${this.#runId}/danmaku/${id}`, {
        method: 'DELETE'
      });
      if (!res.ok && res.status !== 404) {
        this.error = `Delete failed (HTTP ${res.status})`;
        return false;
      }
      this.messages = this.messages.filter((m) => m.id !== id);
      this.flying = this.flying.filter((m) => m.id !== id);
      return true;
    } catch (e) {
      this.error = e instanceof Error ? e.message : 'Network error';
      return false;
    }
  }

  /** 列表弹窗向上翻页(更早消息) */
  async loadOlder() {
    if (!this.#runId || this.loadingOlder) return;
    const first = this.#firstId();
    if (!first) return;
    this.loadingOlder = true;
    try {
      const older = await this.#fetchMessages(`?before_id=${first}&limit=${PAGE_LIMIT}`);
      if (older.length < PAGE_LIMIT) this.hasOlder = false;
      const known = new Set(this.messages.map((m) => m.id));
      const added = older.filter((m) => !known.has(m.id));
      if (added.length) this.messages = [...added, ...this.messages];
    } catch (e) {
      this.error = e instanceof Error ? e.message : 'Load failed';
    } finally {
      this.loadingOlder = false;
    }
  }

  /** 发送:乐观插入(temp 负 id)→ POST → 折叠为服务端 id;失败回滚 */
  async send(content: string): Promise<boolean> {
    const text = content.trim();
    if (!text || !this.#runId || this.sending) return false;
    this.sending = true;
    this.error = '';
    const nickname = this.effectiveNickname;
    const color = this.color;
    const tempId = -(++this.#tempSeq);
    const temp: DanmakuMsg = {
      id: tempId,
      run_id: this.#runId,
      nickname,
      content: text,
      color,
      created_at: Date.now() / 1000,
      temp: true
    };
    this.messages = [...this.messages, temp];
    if (this.playMode !== 'off') this.flying = [...this.flying, ...this.#toFlying([temp])];
    const rollback = () => {
      this.messages = this.messages.filter((m) => m.id !== tempId);
      this.flying = this.flying.filter((m) => m.id !== tempId);
    };
    try {
      const res = await fetch(`/api/v1/runs/${this.#runId}/danmaku`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content: text, nickname, client_id: this.#clientId, color })
      });
      if (res.status === 429) {
        rollback();
        this.error = 'Too frequent — wait a few seconds';
        return false;
      }
      if (!res.ok) {
        rollback();
        this.error = res.status === 400 ? 'Invalid content' : `Send failed (HTTP ${res.status})`;
        return false;
      }
      const created = await res.json();
      if (typeof created.id === 'number') {
        // 走 merge 折叠:temp 落定为真 id,flying 条目 fkey 不变(不重复起飞)
        this.#merge([
          {
            id: created.id,
            run_id: temp.run_id,
            nickname,
            content: text,
            color,
            created_at:
              typeof created.created_at === 'number' ? created.created_at : temp.created_at
          }
        ]);
      }
      return true;
    } catch (e) {
      rollback();
      this.error = e instanceof Error ? e.message : '网络错误';
      return false;
    } finally {
      this.sending = false;
    }
  }
}

export const danmakuStore = new DanmakuStore();

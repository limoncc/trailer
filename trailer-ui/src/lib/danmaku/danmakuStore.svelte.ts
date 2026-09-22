/**
 * Boards 弹幕 store — 模块级单例(对齐 sidebar-state/projectsStore 的 runes 单例模式)。
 *
 * 三态互斥:off(关) / barrage(页面横飘) / list(消息列表弹窗),偏好存 localStorage;
 * 数据 per-run:attach 拉最近历史,开启时每 2s 轮询 since_id 增量,关闭即停表。
 * 发送走全局 fetch(authFetch 已 patch:登录自动 Bearer、分享页自动附 ?token=)。
 */

export type DanmakuMode = 'off' | 'barrage' | 'list';

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
export const MAX_NICKNAME = 24;

export interface DanmakuMsg {
  /** 服务端自增 id;乐观消息用负数 temp id */
  id: number;
  run_id: string;
  nickname: string;
  content: string;
  created_at: number;
  temp?: boolean;
  /** 推入 flying 时分配的本地序号:Layer 的去重键,id 落定/替换后保持稳定 */
  fkey?: number;
}

function readMode(): DanmakuMode {
  if (typeof localStorage === 'undefined') return 'off';
  try {
    const v = localStorage.getItem(MODE_KEY);
    return v === 'barrage' || v === 'list' ? v : 'off';
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
  mode = $state<DanmakuMode>(readMode());
  nickname = $state(readStr(NICK_KEY));
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
  #clientId = readStr(CLIENT_KEY);
  #tempSeq = 0;
  #fkeySeq = 0;

  constructor() {
    if (!this.#clientId) {
      this.#clientId = randomId();
      writeStr(CLIENT_KEY, this.#clientId);
    }
  }

  /** 空昵称时生成「访客xxxxxx」 */
  get effectiveNickname(): string {
    const nick = this.nickname.trim();
    if (nick) return nick.slice(0, MAX_NICKNAME);
    return `访客${randomId().replace(/-/g, '').slice(0, 6)}`;
  }

  setNickname(v: string) {
    this.nickname = v;
    writeStr(NICK_KEY, v);
  }

  setMode(m: DanmakuMode) {
    const wasOff = this.mode === 'off';
    this.mode = m;
    writeStr(MODE_KEY, m);
    if (m === 'off') this.flying = [];
    if (m === 'barrage' && wasOff) {
      // 开启瞬间先静默补一次增量,避免 off 期间积压的消息一齐飞出
      void this.#poll(true);
    }
    this.#syncPolling();
  }

  /** 工具栏按钮:关→横飘→列表→关 */
  cycleMode() {
    this.setMode(this.mode === 'off' ? 'barrage' : this.mode === 'barrage' ? 'list' : 'off');
  }

  attach(runId: string) {
    if (this.#runId === runId) return;
    this.#runId = runId;
    this.messages = [];
    this.flying = [];
    this.hasOlder = false;
    this.error = '';
    void this.#loadLatest();
    this.#syncPolling();
  }

  detach() {
    this.#runId = null;
    this.#stopPolling();
    this.messages = [];
    this.flying = [];
    this.hasOlder = false;
  }

  /** barrage 结束动画时由 Layer 按 fkey 回调移除(messages 保留) */
  flyDone(fkey: number) {
    this.flying = this.flying.filter((m) => m.fkey !== fkey);
  }

  /** 推入在飞队列并分配 fkey(Layer 以此去重,跨 id 替换稳定) */
  #toFlying(msgs: DanmakuMsg[]): DanmakuMsg[] {
    return msgs.map((m) => ({ ...m, fkey: ++this.#fkeySeq }));
  }

  #syncPolling() {
    this.#stopPolling();
    if (this.#runId && this.mode !== 'off') {
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
      // 历史只进列表,不进 flying(避免开启弹幕瞬间全飞)
      this.#merge(msgs);
      if (msgs.length === HISTORY_LIMIT) this.hasOlder = true;
    } catch (e) {
      this.error = e instanceof Error ? e.message : '加载弹幕失败';
    }
  }

  async #poll(silent: boolean) {
    if (!this.#runId) return;
    try {
      const fresh = await this.#fetchMessages(`?since_id=${this.#lastId()}&limit=100`);
      const added = this.#merge(fresh);
      if (!silent && this.mode === 'barrage' && added.length) {
        this.flying = [...this.flying, ...this.#toFlying(added)];
      }
    } catch {
      /* 轮询静默失败,下一拍重试 */
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
      this.error = e instanceof Error ? e.message : '加载失败';
    } finally {
      this.loadingOlder = false;
    }
  }

  /** 发送:乐观插入(temp 负 id)→ POST → 用服务端 id 替换;失败回滚 */
  async send(content: string): Promise<boolean> {
    const text = content.trim();
    if (!text || !this.#runId || this.sending) return false;
    this.sending = true;
    this.error = '';
    const nickname = this.effectiveNickname;
    const tempId = -(++this.#tempSeq);
    const temp: DanmakuMsg = {
      id: tempId,
      run_id: this.#runId,
      nickname,
      content: text,
      created_at: Date.now() / 1000,
      temp: true
    };
    this.messages = [...this.messages, temp];
    if (this.mode === 'barrage') this.flying = [...this.flying, ...this.#toFlying([temp])];
    const rollback = () => {
      this.messages = this.messages.filter((m) => m.id !== tempId);
      this.flying = this.flying.filter((m) => m.id !== tempId);
    };
    try {
      const res = await fetch(`/api/v1/runs/${this.#runId}/danmaku`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content: text, nickname, client_id: this.#clientId })
      });
      if (res.status === 429) {
        rollback();
        this.error = '发送太频繁,几秒后再试';
        return false;
      }
      if (!res.ok) {
        rollback();
        this.error = res.status === 400 ? '内容不合法' : `发送失败(HTTP ${res.status})`;
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

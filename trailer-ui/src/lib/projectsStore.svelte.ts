/**
 * 共享项目/用户状态 — layout 加载,侧栏与项目页共用。
 * 项目 owner 映射:project → owner_id(取自 runs 的 owner_id)。
 */
export type UserInfo = { id: number; username: string; role: string } | null;

/** 侧栏折叠态"最近 run"快捷入口所需的最小 run 信息 */
export type RunLite = { id: string; name: string; project: string; created_at: number };

let _projects = $state<string[]>([]);
let _owners = $state<Map<string, number | null>>(new Map());
let _user = $state<UserInfo>(null);
let _latestRun = $state<RunLite | null>(null);

export function getProjects() { return _projects; }
export function getOwners() { return _owners; }
export function getUser() { return _user; }
export function getLatestRun() { return _latestRun; }

export function setProjects(p: string[]) { _projects = p; }
export function setOwners(o: Map<string, number | null>) { _owners = o; }
export function setUser(u: UserInfo) { _user = u; }
export function setLatestRun(r: RunLite | null) { _latestRun = r; }

/** 取 created_at 最新的 run;并列取先出现者,空列表返回 null */
export function pickLatestRun(runs: RunLite[]): RunLite | null {
  let best: RunLite | null = null;
  for (const r of runs) {
    if (!best || r.created_at > best.created_at) best = r;
  }
  return best;
}

/**
 * 共享项目/用户状态 — layout 加载,侧栏与项目页共用。
 * 项目 owner 映射:project → owner_id(取自 runs 的 owner_id)。
 */
export type UserInfo = { id: number; username: string; role: string } | null;

let _projects = $state<string[]>([]);
let _owners = $state<Map<string, number | null>>(new Map());
let _user = $state<UserInfo>(null);

export function getProjects() { return _projects; }
export function getOwners() { return _owners; }
export function getUser() { return _user; }

export function setProjects(p: string[]) { _projects = p; }
export function setOwners(o: Map<string, number | null>) { _owners = o; }
export function setUser(u: UserInfo) { _user = u; }

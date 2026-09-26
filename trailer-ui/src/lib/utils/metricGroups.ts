export interface MetricOption {
  key: string;
  context: string;
  count?: number;
  /** 该指标有数据的 run(调用方提供 = 树里出 run 层;缺省 = 指标即叶子) */
  owners?: string[];
}

export interface MetricGroup<T = MetricOption> {
  context: string;
  label: string;
  items: T[];
}

export interface SelectionState {
  all: boolean;
  some: boolean;
  none: boolean;
}

/** canonical id — 沿用 Run 页 metricId 约定: key[context] 或 key */
export function metricId(m: { key: string; context: string }): string {
  return m.context ? `${m.key}[${m.context}]` : m.key;
}

const DEFAULT_GROUP_ORDER = ['train', 'val', 'test', 'system'];

/**
 * 按 context 分组。多级 context(system/nvidia/gpu0) 归入首段(system)。
 * 组排序: root('') 最前, 其余按 order, 未在 order 中的按 label 字母序。
 * 组内按 key 排序。
 */
export function groupMetricsByContext<T extends { key: string; context: string }>(
  options: T[],
  opts: { rootLabel?: string; order?: string[] } = {},
): MetricGroup<T>[] {
  const { rootLabel = 'root', order = DEFAULT_GROUP_ORDER } = opts;
  const buckets = new Map<string, T[]>();
  for (const o of options) {
    const ctx = o.context === '' ? '' : o.context.split('/')[0];
    const arr = buckets.get(ctx);
    if (arr) arr.push(o);
    else buckets.set(ctx, [o]);
  }
  for (const arr of buckets.values()) arr.sort((a, b) => a.key.localeCompare(b.key));

  const orderIdx = new Map(order.map((name, i) => [name, i]));
  const keys = [...buckets.keys()].sort((a, b) => {
    if (a === '') return -1;
    if (b === '') return 1;
    const ia = orderIdx.get(a);
    const ib = orderIdx.get(b);
    if (ia != null && ib != null) return ia - ib;
    if (ia != null) return -1;
    if (ib != null) return 1;
    return a.localeCompare(b);
  });

  return keys.map((ctx) => ({
    context: ctx,
    label: ctx === '' ? rootLabel : ctx,
    items: buckets.get(ctx)!,
  }));
}

// ─── 通用路径树:多段路径逐级成目录,叶子只留末段 ───

export interface PathTreeDir<T> {
  type: 'dir';
  /** 完整路径段(join('/')),折叠态 key 用它 */
  path: string;
  label: string;
  children: PathTreeNode<T>[];
  /** 子树全部叶子(勾选传播/计数用) */
  items: T[];
}

export interface PathTreeLeaf<T> {
  type: 'leaf';
  item: T;
  label: string;
}

export type PathTreeNode<T> = PathTreeDir<T> | PathTreeLeaf<T>;

interface BuildDir<T> {
  label: string;
  path: string;
  /** 空路径段建出的 rootLabel 目录(排序永远最前,与旧 groupMetricsByContext 的 '' 特判一致) */
  isRoot: boolean;
  dirs: Map<string, BuildDir<T>>;
  leaves: Array<{ item: T; label: string }>;
}

/**
 * 按路径段建树。segsOf 返回 [] 的项进 rootLabel 目录。
 * 排序(与 groupMetricsByContext 同规则):root 目录最前 → order 中的首段按序 → 字母序;
 * 同级 **dir 在 leaf 前**,叶子按 label 字母序。
 * 旧的首段分组 groupMetricsByContext 原样保留 —— optgroup / WidgetPickerDialog 仍依赖它。
 */
export function buildPathTree<T>(
  items: T[],
  segsOf: (t: T) => string[],
  labelOf: (t: T) => string,
  opts: { rootLabel?: string; order?: string[] } = {},
): PathTreeNode<T>[] {
  const { rootLabel = 'root', order = DEFAULT_GROUP_ORDER } = opts;
  const root: BuildDir<T> = { label: '', path: '', isRoot: false, dirs: new Map(), leaves: [] };

  const ensure = (parent: BuildDir<T>, seg: string, isRoot = false): BuildDir<T> => {
    const path = parent.path ? `${parent.path}/${seg}` : seg;
    let d = parent.dirs.get(seg);
    if (!d) {
      d = { label: seg, path, isRoot, dirs: new Map(), leaves: [] };
      parent.dirs.set(seg, d);
    }
    return d;
  };

  for (const item of items) {
    const segs = segsOf(item).filter(Boolean);
    let node = root;
    if (segs.length === 0) node = ensure(root, rootLabel, true);
    else for (const seg of segs) node = ensure(node, seg);
    node.leaves.push({ item, label: labelOf(item) });
  }

  const orderIdx = new Map(order.map((name, i) => [name, i]));
  const cmpDir = (a: BuildDir<T>, b: BuildDir<T>): number => {
    if (a.isRoot !== b.isRoot) return a.isRoot ? -1 : 1;
    const ia = orderIdx.get(a.label);
    const ib = orderIdx.get(b.label);
    if (ia != null && ib != null) return ia - ib;
    if (ia != null) return -1;
    if (ib != null) return 1;
    return a.label.localeCompare(b.label);
  };

  const emit = (d: BuildDir<T>): PathTreeDir<T> => {
    const dirs = [...d.dirs.values()].sort(cmpDir).map(emit);
    const leaves: PathTreeLeaf<T>[] = [...d.leaves]
      .sort((a, b) => a.label.localeCompare(b.label))
      .map((l) => ({ type: 'leaf', item: l.item, label: l.label }));
    const children: PathTreeNode<T>[] = [...dirs, ...leaves];
    return { type: 'dir', path: d.path, label: d.label, children, items: children.flatMap((c) => (c.type === 'dir' ? c.items : [c.item])) };
  };

  return [...root.dirs.values()].sort(cmpDir).map(emit);
}

/** 大小写不敏感; 按空格/英文逗号/中文逗号分词, 每个词须命中 key / context/key / key [context] 之一(AND)。 */
export function filterMetrics<T extends { key: string; context: string }>(options: T[], query: string): T[] {
  const tokens = query
    .split(/[ ,，]/)
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
  if (tokens.length === 0) return options;
  return options.filter((o) => {
    const id = metricId(o).toLowerCase();
    const combined = o.context ? `${o.context}/${o.key}`.toLowerCase() : o.key.toLowerCase();
    const keyOnly = o.key.toLowerCase();
    const bracketed = `${o.key} [${o.context}]`.toLowerCase();
    return tokens.every((t) => id.includes(t) || combined.includes(t) || keyOnly.includes(t) || bracketed.includes(t));
  });
}

export function selectionState(
  items: { key: string; context: string }[],
  selectedIds: ReadonlySet<string>,
): SelectionState {
  if (items.length === 0) return { all: false, some: false, none: true };
  let count = 0;
  for (const it of items) if (selectedIds.has(metricId(it))) count++;
  return {
    all: count === items.length,
    some: count > 0 && count < items.length,
    none: count === 0,
  };
}

export interface MetricOption {
  key: string;
  context: string;
  count?: number;
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

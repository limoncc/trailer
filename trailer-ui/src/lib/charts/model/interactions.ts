/** Pure interaction logic for the model graph: expand/collapse budget with
 *  LRU eviction (borrowed from modelmap's store), ancestor trails for search
 *  reveal + breadcrumbs, and camera framing math for the leafer canvas. */
import type { GraphNode } from './layout';

export const RENDER_BUDGET = 300;

function parentId(id: string): string | null {
  const i = id.lastIndexOf('.');
  return i < 0 ? null : id.slice(0, i);
}

/** proper ancestors of a dot-path id, excluding the id itself */
export function ancestorsOf(id: string): string[] {
  const parts = id.split('.');
  const out: string[] = [];
  for (let i = 1; i < parts.length; i++) out.push(parts.slice(0, i).join('.'));
  return out;
}

/** number of boxes the current collapsed set puts on screen */
export function countVisible(root: GraphNode, collapsed: Set<string>): number {
  let n = 0;
  (function walk(node: GraphNode) {
    n++;
    if (node.children?.length && !collapsed.has(node.id)) node.children.forEach(walk);
  })(root);
  return n;
}

export interface BudgetResult {
  collapsed: Set<string>;
  /** containers still open, least-recently opened first */
  order: string[];
  /** how many containers had to be re-collapsed (drives the toast) */
  evicted: number;
}

/** Keep the visible node count under `budget`: when an expansion would exceed
 *  it, the least recently opened containers are re-collapsed — never the one
 *  just opened nor its ancestors. Mirrors modelmap store.ts §10. */
export function enforceBudget(
  root: GraphNode,
  collapsed: Set<string>,
  openOrder: string[],
  opened: string | null,
  budget: number = RENDER_BUDGET,
): BudgetResult {
  const next = new Set(collapsed);
  const order = [...openOrder];
  if (opened && !order.includes(opened)) order.push(opened);
  for (let i = order.length - 1; i >= 0; i--) if (next.has(order[i])) order.splice(i, 1);

  const protect = new Set<string>(['']);
  if (opened) for (let cur: string | null = opened; cur; cur = parentId(cur)) protect.add(cur);

  let evicted = 0;
  while (countVisible(root, next) > budget) {
    const victim = order.find((id) => !protect.has(id) && !next.has(id));
    if (!victim) break;
    next.add(victim);
    order.splice(order.indexOf(victim), 1);
    evicted++;
  }
  return { collapsed: next, order, evicted };
}

export interface FrameTransform {
  scale: number;
  x: number;
  y: number;
}

/** Content-group transform that centers `box` in a view of vw×vh with `pad`
 *  relative margin on each side. */
export function computeFrame(
  box: { x: number; y: number; w: number; h: number },
  vw: number,
  vh: number,
  pad = 0.12,
  maxScale = 1.4,
  minScale = 0.02,
): FrameTransform {
  const usableW = Math.max(1, vw * (1 - 2 * pad));
  const usableH = Math.max(1, vh * (1 - 2 * pad));
  const scale = Math.max(minScale, Math.min(usableW / Math.max(box.w, 1), usableH / Math.max(box.h, 1), maxScale));
  return {
    scale,
    x: vw / 2 - (box.x + box.w / 2) * scale,
    y: vh / 2 - (box.y + box.h / 2) * scale,
  };
}

export function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

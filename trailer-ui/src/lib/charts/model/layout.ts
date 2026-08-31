/** ELK-backed geometry for the model graph.
 *
 *  Borrowed from modelmap's layout: containers are ELK compound nodes, top
 *  levels read left-to-right while block internals stack top-to-bottom, and
 *  collapsed containers shrink to fixed-size leaves. One ELK instance runs in
 *  a Web Worker (injected, or the bundled no-worker build in tests) so large
 *  expansions never block the main thread.
 *
 *  This module is pure computation: it takes the graph spec + collapsed set
 *  and returns boxes, orthogonal edge routes and overall bounds. Trailer keeps
 *  leafer-ui for drawing and interaction — nothing here touches the DOM.
 */
import { canvasMeasure } from './measure';

export type Measurer = (text: string, size: number, weight?: number) => number;

export interface GraphNode {
  id: string;
  name: string;
  class?: string;
  kind?: string;
  params?: { total: number; trainable: number; self: number; fmt: string };
  repeat?: { count: number; names: string[]; group_params?: number; group_fmt?: string };
  badge?: string;
  op?: string;
  io?: { in: string[]; out: string[] };
  io_hint?: { in: string; out: string };
  attrs?: Record<string, unknown>;
  variant?: string;
  moe_experts?: number;
  moe_routing?: { num_experts: number; experts_per_tok?: number | null; router: string; label: string };
  children?: GraphNode[];
  sequential?: boolean;
}

export interface GraphEdge {
  source: string;
  target: string;
  kind?: string;
  shape?: string;
}

export interface Spec {
  meta?: Record<string, unknown>;
  tree: GraphNode;
  edges?: GraphEdge[];
}

export interface Box {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  node: GraphNode;
  depth: number;
}

export interface EdgeRoute {
  source: string;
  target: string;
  kind: string;
  shape?: string;
  path: string;
  sx: number;
  sy: number;
  ex: number;
  ey: number;
  /** midpoint of the middle segment — where kind labels are drawn */
  mx: number;
  my: number;
  arrowDir: 'up' | 'down' | 'left' | 'right';
}

export interface LayoutResult {
  boxes: Record<string, Box>;
  routes: EdgeRoute[];
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
}

export interface PreparedEdge {
  source: string;
  target: string;
  kind: string;
  shape?: string;
}

// --- geometry constants (parity with the previous hand-rolled layout) ---
export const HEADER_H = 30;
export const LEAF_H = 44;
export const LEAF_H3 = 58;
export const COLLAPSED_H = 34;
export const PAD_X = 18;
export const PAD_BOTTOM = 16;
export const MIN_LEAF_W = 96;

const PAD_TOP = 44;
const PADDING = `[top=${PAD_TOP},left=${PAD_X},bottom=${PAD_BOTTOM},right=${PAD_X}]`;

const BASE_OPTS: Record<string, string> = {
  'elk.algorithm': 'layered',
  'elk.edgeRouting': 'ORTHOGONAL',
  'elk.layered.spacing.nodeNodeBetweenLayers': '44',
  'elk.spacing.nodeNode': '24',
};

/** Top levels read left-to-right; block internals stack top-to-bottom. */
function dirFor(depth: number): 'RIGHT' | 'DOWN' {
  return depth <= 2 ? 'RIGHT' : 'DOWN';
}

// --- display helpers (shared with the drawing component) ---

export function displayName(n: GraphNode): string {
  let s = n.name || '';
  if (n.repeat) s += '  ×' + n.repeat.count;
  return s;
}

export function subLabel(n: GraphNode): string {
  let s = n.variant || n.class || '';
  if (n.moe_experts) s += ' · MoE×' + n.moe_experts;
  if (n.params && n.params.total > 0) s += ' · ' + (n.repeat ? n.repeat.group_fmt : n.params.fmt);
  return s;
}

export function ioLabel(n: GraphNode): string | null {
  if (n.io && n.io.in && n.io.in.length && n.io.out && n.io.out.length)
    return n.io.in[0].replace(/ \w+$/, '') + ' → ' + n.io.out[0].replace(/ \w+$/, '');
  if (n.io_hint) return n.io_hint.in + ' → ' + n.io_hint.out;
  return null;
}

// --- tree helpers (node ids are dot paths) ---

function parentId(id: string): string | null {
  const i = id.lastIndexOf('.');
  return i < 0 ? null : id.slice(0, i);
}

export function depthOf(id: string): number {
  return id.split('.').length - 1;
}

export function indexTree(n: GraphNode): Record<string, GraphNode> {
  const out: Record<string, GraphNode> = {};
  (function walk(node: GraphNode) {
    out[node.id] = node;
    (node.children ?? []).forEach(walk);
  })(n);
  return out;
}

/** visible = indexed and no *strict* ancestor is collapsed */
function isVisible(id: string, nodeById: Record<string, GraphNode>, collapsed: Set<string>): boolean {
  if (!nodeById[id]) return false;
  let cur = parentId(id);
  while (cur) {
    if (collapsed.has(cur)) return false;
    cur = parentId(cur);
  }
  return true;
}

/** a container is expanded when it has children and nothing above it (incl.
 *  itself) is collapsed */
function isExpanded(id: string, nodeById: Record<string, GraphNode>, collapsed: Set<string>): boolean {
  const n = nodeById[id];
  if (!n || !n.children?.length) return false;
  let cur: string | null = id;
  while (cur) {
    if (collapsed.has(cur)) return false;
    cur = parentId(cur);
  }
  return true;
}

// --- edge preparation ---

const EDGE_PRI: Record<string, number> = { routing: 3, residual: 2, loop: 2 };

/** Lift edge endpoints to nearest visible ancestors, dedupe by endpoint pair
 *  (highest-priority kind wins), and synthesise order chains for expanded
 *  containers without overriding explicit edges. */
export function prepareEdges(
  edges: GraphEdge[],
  nodeById: Record<string, GraphNode>,
  collapsed: Set<string>,
): PreparedEdge[] {
  const visRep = (id: string): string | null => {
    let cur = id;
    while (cur && !isVisible(cur, nodeById, collapsed)) cur = parentId(cur);
    return cur;
  };
  const drawn = new Map<string, PreparedEdge>();
  const put = (s: string | null, t: string | null, kind: string, shape?: string) => {
    if (!s || !t || s === t) return;
    const key = s + '|' + t;
    const prev = drawn.get(key);
    if (prev) {
      if ((EDGE_PRI[kind] ?? 1) > (EDGE_PRI[prev.kind] ?? 1)) {
        prev.kind = kind;
        if (shape) prev.shape = shape;
      }
      return;
    }
    drawn.set(key, { source: s, target: t, kind, shape });
  };
  for (const e of edges) put(visRep(e.source), visRep(e.target), e.kind || 'tensor', e.shape);
  for (const n of Object.values(nodeById)) {
    if (!isExpanded(n.id, nodeById, collapsed)) continue;
    const kids = n.children ?? [];
    for (let i = 0; i + 1 < kids.length; i++) {
      const key = kids[i].id + '|' + kids[i + 1].id;
      if (!drawn.has(key)) drawn.set(key, { source: kids[i].id, target: kids[i + 1].id, kind: 'order' });
    }
  }
  return [...drawn.values()];
}

// --- sizes ---

function leafSize(n: GraphNode, m: Measurer): { w: number; h: number } {
  const nameW = m(displayName(n), 13, 600) + 30;
  const subW = m(subLabel(n), 10.5) + 30;
  const io = ioLabel(n);
  const ioW = io ? m(io, 9.5) + 30 : 0;
  const badgeW = n.badge ? m(n.badge, 9) + 16 : 0;
  const w = Math.max(MIN_LEAF_W, nameW, subW, n.op ? 0 : ioW, badgeW);
  let h = io ? LEAF_H3 : LEAF_H;
  if (n.badge) h += 16;
  if (n.op) h = Math.max(h, 54);
  return { w, h };
}

function collapsedSize(n: GraphNode, m: Measurer): { w: number; h: number } {
  const nameW = m(displayName(n), 12.5, 600) + 30;
  const subW = m(subLabel(n), 10) + 30;
  const badgeW = n.badge ? m(n.badge, 9) + 16 : 0;
  return { w: Math.max(MIN_LEAF_W, nameW, subW, badgeW), h: COLLAPSED_H + 14 + (n.badge ? 16 : 0) };
}

/** minimum compound size keeps the header row readable */
function minSize(n: GraphNode, m: Measurer): string {
  const headerW = m(displayName(n), 13, 600) + m(subLabel(n), 10.5) + 30 + 40;
  return `(${Math.ceil(Math.max(headerW, MIN_LEAF_W + 40))}, 96)`;
}

// --- ELK plumbing ---

interface ElkPoint {
  x: number;
  y: number;
}
interface ElkShape {
  id: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  layoutOptions?: Record<string, string>;
  children?: ElkShape[];
  edges?: { id: string; sources: string[]; targets: string[]; sections?: ElkSection[] };
}
interface ElkSection {
  startPoint: ElkPoint;
  endPoint: ElkPoint;
  bendPoints?: ElkPoint[];
}

type ElkInstance = { layout: (graph: ElkShape) => Promise<ElkShape> };

let _elk: ElkInstance | null = null;
async function defaultElk(): Promise<ElkInstance> {
  if (!_elk) {
    const { default: ELK } = await import('elkjs/lib/elk-api.js');
    _elk = new ELK({
      workerFactory: () =>
        new Worker(new URL('elkjs/lib/elk-worker.min.js', import.meta.url), { type: 'classic' }),
    }) as unknown as ElkInstance;
  }
  return _elk;
}

export interface LayoutOptions {
  measure?: Measurer;
  elk?: ElkInstance;
}

/** Route every prepared edge at its nearest common ancestor container, with
 *  endpoints lifted to the direct children of that container ("portals").
 *  ELK's layered pass only routes between the nodes it lays out at one
 *  hierarchy level, so an edge into a deeper descendant must stop at the
 *  ancestor it is visually represented by. */
function edgesByAncestor(edges: PreparedEdge[]): Map<string, PreparedEdge[]> {
  const out = new Map<string, PreparedEdge[]>();
  const seen = new Map<string, PreparedEdge>();
  for (const e of edges) {
    const ancSet = new Set<string>();
    for (let cur: string | null = e.source; cur; cur = parentId(cur)) ancSet.add(cur);
    let lca: string | null = null;
    for (let cur: string | null = e.target; cur; cur = parentId(cur)) {
      if (ancSet.has(cur)) {
        lca = cur;
        break;
      }
    }
    if (!lca || lca === e.source || lca === e.target) continue;
    const portal = (id: string): string => {
      let cur = id;
      while (parentId(cur) !== lca) cur = parentId(cur)!;
      return cur;
    };
    const s = portal(e.source);
    const t = portal(e.target);
    if (s === t) continue;
    const key = `${s}|${t}`;
    const prev = seen.get(key);
    if (prev) {
      if ((EDGE_PRI[e.kind] ?? 1) > (EDGE_PRI[prev.kind] ?? 1)) {
        prev.kind = e.kind;
        if (e.shape) prev.shape = e.shape;
      }
      continue;
    }
    const pe: PreparedEdge = { source: s, target: t, kind: e.kind, shape: e.shape };
    seen.set(key, pe);
    const list = out.get(lca) ?? [];
    list.push(pe);
    out.set(lca, list);
  }
  return out;
}

export async function layoutGraph(
  spec: Spec,
  collapsed: Set<string>,
  opts: LayoutOptions = {},
): Promise<LayoutResult> {
  const m = opts.measure ?? canvasMeasure;
  const elk = opts.elk ?? (await defaultElk());
  const tree = spec.tree;
  if (!tree) throw new Error('model graph spec has no tree');
  const nodeById = indexTree(tree);
  const prepared = prepareEdges(spec.edges ?? [], nodeById, collapsed);
  const byParent = edgesByAncestor(prepared);
  const edgeById = new Map<string, PreparedEdge>();
  for (const list of byParent.values()) for (const e of list) edgeById.set(`${e.source}→${e.target}`, e);
  const elkEdgesFor = (id: string) =>
    (byParent.get(id) ?? []).map((e) => ({ id: `${e.source}→${e.target}`, sources: [e.source], targets: [e.target] }));

  const build = (n: GraphNode): ElkShape => {
    const kids = n.children ?? [];
    if (!kids.length || collapsed.has(n.id)) {
      const size = kids.length ? collapsedSize(n, m) : leafSize(n, m);
      return { id: n.id, width: size.w, height: size.h };
    }
    return {
      id: n.id,
      layoutOptions: {
        ...BASE_OPTS,
        'elk.direction': dirFor(depthOf(n.id)),
        'elk.padding': PADDING,
        'elk.nodeSize.minimum': minSize(n, m),
      },
      children: kids.map(build),
      edges: elkEdgesFor(n.id),
    };
  };

  const rootElk: ElkShape = {
    id: tree.id,
    layoutOptions: {
      ...BASE_OPTS,
      'elk.direction': dirFor(depthOf(tree.id)),
      'elk.padding': PADDING,
      'elk.nodeSize.minimum': minSize(tree, m),
    },
    children: (tree.children ?? []).map(build),
    edges: elkEdgesFor(tree.id),
  };

  const laid = await elk.layout(rootElk);

  // absolutise every shape (ELK coordinates are parent-relative)
  const absMap = new Map<string, { x: number; y: number; s: ElkShape }>();
  const walkAbs = (shapes: ElkShape[], ox: number, oy: number) => {
    for (const s of shapes) {
      const ax = ox + (s.x ?? 0);
      const ay = oy + (s.y ?? 0);
      absMap.set(s.id, { x: ax, y: ay, s });
      walkAbs(s.children ?? [], ax, ay);
    }
  };
  walkAbs(laid.children ?? [], 0, 0);

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const { x, y, s } of absMap.values()) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + (s.width ?? 0));
    maxY = Math.max(maxY, y + (s.height ?? 0));
  }
  if (!absMap.size) {
    minX = minY = 0;
    maxX = maxY = 200;
  }
  const offX = minX - PAD_X;
  const offY = minY - PAD_TOP;

  const boxes: Record<string, Box> = {
    [tree.id]: { id: tree.id, x: 0, y: 0, w: maxX - minX + PAD_X * 2, h: maxY - minY + PAD_TOP + PAD_BOTTOM, node: tree, depth: depthOf(tree.id) },
  };
  for (const [id, { x, y, s }] of absMap) {
    boxes[id] = { id, x: x - offX, y: y - offY, w: s.width ?? 0, h: s.height ?? 0, node: nodeById[id], depth: depthOf(id) };
  }

  // collect routed edges at every hierarchy level
  const routes: EdgeRoute[] = [];
  const routeEdges = (elkEdges: ElkShape['edges'], containerAbs: { x: number; y: number }) => {
    for (const e of elkEdges ?? []) {
      const p = edgeById.get(e.id);
      const section = e.sections?.[0];
      if (!p || !section) continue;
      const pts = [section.startPoint, ...(section.bendPoints ?? []), section.endPoint].map(
        (pt) => ({ x: pt.x + containerAbs.x - offX, y: pt.y + containerAbs.y - offY }),
      );
      const last = pts[pts.length - 1];
      const prev = pts[pts.length - 2] ?? pts[0];
      const dx = last.x - prev.x;
      const dy = last.y - prev.y;
      const arrowDir: EdgeRoute['arrowDir'] =
        Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? 'right' : 'left') : dy >= 0 ? 'down' : 'up';
      const midIdx = Math.max(0, Math.floor((pts.length - 2) / 2));
      const mx = (pts[midIdx].x + pts[midIdx + 1].x) / 2;
      const my = (pts[midIdx].y + pts[midIdx + 1].y) / 2;
      routes.push({
        source: p.source,
        target: p.target,
        kind: p.kind,
        shape: p.shape,
        path: 'M ' + pts.map((pt) => `${pt.x} ${pt.y}`).join(' L '),
        sx: pts[0].x,
        sy: pts[0].y,
        ex: last.x,
        ey: last.y,
        mx,
        my,
        arrowDir,
      });
    }
  };
  for (const [id, { x, y, s }] of absMap) routeEdges(s.edges, { x, y });
  routeEdges(laid.edges, { x: offX, y: offY });

  let bMinX = Infinity;
  let bMinY = Infinity;
  let bMaxX = -Infinity;
  let bMaxY = -Infinity;
  for (const b of Object.values(boxes)) {
    bMinX = Math.min(bMinX, b.x);
    bMinY = Math.min(bMinY, b.y);
    bMaxX = Math.max(bMaxX, b.x + b.w);
    bMaxY = Math.max(bMaxY, b.y + b.h);
  }
  return { boxes, routes, bounds: { minX: bMinX, minY: bMinY, maxX: bMaxX, maxY: bMaxY } };
}

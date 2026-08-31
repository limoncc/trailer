import { describe, it, expect } from 'vitest';
import ELK from 'elkjs/lib/elk.bundled.js';
import { layoutGraph, prepareEdges, edgeWidth } from './layout';
import type { GraphNode, Measurer } from './layout';

/** Deterministic fake measurer: width tracks char count × size. */
const measure: Measurer = (text, size) => text.length * size * 0.6;

function leaf(id: string): GraphNode {
  return { id, name: id.split('.').pop()!, class: 'Linear', kind: 'leaf', params: { total: 10, trainable: 10, self: 10, fmt: '10' } };
}

function container(id: string, children: GraphNode[]): GraphNode {
  return { id, name: id.split('.').pop()!, class: 'Block', kind: 'container', params: { total: 30, trainable: 30, self: 0, fmt: '30' }, children };
}

const elk = new ELK();

describe('layoutGraph', () => {
  it('lays sibling leaves out disjoint and ordered along the flow direction', async () => {
    const spec = {
      meta: { name: 'm' },
      tree: container('root', [leaf('root.a'), leaf('root.b'), leaf('root.c')]),
      edges: [
        { source: 'root.a', target: 'root.b', kind: 'order' },
        { source: 'root.b', target: 'root.c', kind: 'order' },
      ],
    };
    const r = await layoutGraph(spec as any, new Set(), { measure, elk });
    const a = r.boxes['root.a'], b = r.boxes['root.b'], c = r.boxes['root.c'];
    expect(a && b && c).toBeTruthy();
    // 全纵向:自上而下排列
    expect(b.y).toBeGreaterThan(a.y);
    expect(c.y).toBeGreaterThan(b.y);
    // 无重叠
    expect(b.y).toBeGreaterThanOrEqual(a.y + a.h);
    expect(c.y).toBeGreaterThanOrEqual(b.y + b.h);
  });

  it('draws collapsed containers as fixed boxes and hides their children', async () => {
    const spec = {
      meta: { name: 'm' },
      tree: container('root', [
        leaf('root.a'),
        container('root.block', [leaf('root.block.x'), leaf('root.block.y')]),
      ]),
      edges: [],
    };
    const r = await layoutGraph(spec as any, new Set(['root.block']), { measure, elk });
    expect(r.boxes['root.block']).toBeTruthy();
    expect(r.boxes['root.block.x']).toBeUndefined();
    expect(r.boxes['root.block.y']).toBeUndefined();
    // collapsed box is compact: no bigger than an expanded leaf
    expect(r.boxes['root.block'].h).toBeLessThanOrEqual(64);
  });

  it('expanded containers fully contain their children', async () => {
    const spec = {
      meta: { name: 'm' },
      tree: container('root', [
        container('root.block', [leaf('root.block.x'), leaf('root.block.y')]),
        leaf('root.out'),
      ]),
      edges: [{ source: 'root.block.x', target: 'root.block.y', kind: 'order' }],
    };
    const r = await layoutGraph(spec as any, new Set(), { measure, elk });
    const p = r.boxes['root.block'];
    expect(p).toBeTruthy();
    for (const id of ['root.block.x', 'root.block.y']) {
      const b = r.boxes[id];
      expect(b).toBeTruthy();
      expect(b.x).toBeGreaterThanOrEqual(p.x);
      expect(b.y).toBeGreaterThanOrEqual(p.y);
      expect(b.x + b.w).toBeLessThanOrEqual(p.x + p.w + 0.5);
      expect(b.y + b.h).toBeLessThanOrEqual(p.y + p.h + 0.5);
    }
  });

  it('routes sibling edges orthogonally with endpoints on the node borders', async () => {
    const spec = {
      meta: { name: 'm' },
      tree: container('root', [leaf('root.a'), leaf('root.b')]),
      edges: [{ source: 'root.a', target: 'root.b', kind: 'order' }],
    };
    const r = await layoutGraph(spec as any, new Set(), { measure, elk });
    expect(r.routes).toHaveLength(1);
    const route = r.routes[0];
    expect(route.path.startsWith('M')).toBe(true);
    const near = (px: number, py: number, b: { x: number; y: number; w: number; h: number }) =>
      px >= b.x - 2 && px <= b.x + b.w + 2 && py >= b.y - 2 && py <= b.y + b.h + 2;
    expect(near(route.sx, route.sy, r.boxes['root.a'])).toBe(true);
    expect(near(route.ex, route.ey, r.boxes['root.b'])).toBe(true);
  });

  it('lifts edges into collapsed containers to the container box', async () => {
    const spec = {
      meta: { name: 'm' },
      tree: container('root', [
        leaf('root.a'),
        container('root.block', [leaf('root.block.x')]),
      ]),
      edges: [{ source: 'root.a', target: 'root.block.x', kind: 'residual' }],
    };
    const r = await layoutGraph(spec as any, new Set(['root.block']), { measure, elk });
    expect(r.routes).toHaveLength(1);
    const route = r.routes[0];
    const tb = r.boxes['root.block'];
    const onTarget = route.ex >= tb.x - 2 && route.ex <= tb.x + tb.w + 2 && route.ey >= tb.y - 2 && route.ey <= tb.y + tb.h + 2;
    expect(onTarget).toBe(true);
  });

  it('sizes boxes from the injected measurer', async () => {
    const wide = { ...leaf('root.a'), name: 'a'.repeat(40) };
    const spec = { meta: { name: 'm' }, tree: container('root', [wide]), edges: [] };
    const r = await layoutGraph(spec as any, new Set(), { measure, elk });
    expect(r.boxes['root.a'].w).toBeGreaterThan(300);
  });
});

describe('prepareEdges', () => {
  it('dedups endpoint pairs keeping the highest-priority kind', () => {
    const edges = [
      { source: 'a', target: 'b', kind: 'order' },
      { source: 'a', target: 'b', kind: 'routing' },
      { source: 'a', target: 'b', kind: 'residual' },
    ];
    const out = prepareEdges(edges, { a: leaf('a'), b: leaf('b') } as any, new Set());
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe('routing');
  });

  it('drops edges that collapse onto the same visible node', () => {
    const edges = [{ source: 'blk.x', target: 'blk.y', kind: 'order' }];
    const out = prepareEdges(edges, {} as any, new Set(['blk']));
    expect(out).toHaveLength(0);
  });

  it('lifts endpoints to the nearest visible ancestor', () => {
    const index = {
      blk: container('blk', [leaf('blk.x')]),
    } as any;
    const out = prepareEdges(
      [{ source: 'a', target: 'blk.x', kind: 'residual' }],
      { a: leaf('a'), ...index } as any,
      new Set(['blk']),
    );
    expect(out).toHaveLength(1);
    expect(out[0].source).toBe('a');
    expect(out[0].target).toBe('blk');
  });

  it('synthesises order chains for expanded containers without overriding explicit edges', () => {
    const tree = container('root', [leaf('root.a'), leaf('root.b'), leaf('root.c')]);
    const explicit = [{ source: 'root.b', target: 'root.c', kind: 'routing' }];
    const out = prepareEdges(explicit, indexTree(tree), new Set());
    const pair = (e: { source: string; target: string }) => `${e.source}|${e.target}`;
    const keys = out.map(pair);
    expect(keys).toContain('root.a|root.b');
    expect(keys).toContain('root.b|root.c');
    // explicit routing edge wins the shared pair
    expect(out.find((e) => pair(e) === 'root.b|root.c')!.kind).toBe('routing');
  });
});

describe('edgeWidth', () => {
  it('defaults to the base width without traced output', () => {
    expect(edgeWidth(undefined)).toBe(1.2);
    expect(edgeWidth({ id: 'x', name: 'x' })).toBe(1.2);
  });
  it('grows logarithmically with tensor size and caps at 2.8', () => {
    expect(edgeWidth({ id: 'x', name: 'x', io: { out: ['(2, 8) float32'], in: [] } })).toBeCloseTo(1.1, 5);
    const w16k = edgeWidth({ id: 'x', name: 'x', io: { out: ['(4, 4096) float32'], in: [] } });
    expect(w16k).toBeGreaterThan(1.2);
    expect(w16k).toBeLessThan(2.8);
    const huge = edgeWidth({ id: 'x', name: 'x', io: { out: ['(4096, 4096) float32'], in: [] } });
    expect(huge).toBeCloseTo(2.8, 1);
  });
});

/** tiny helper mirroring the component's tree index */
function indexTree(n: GraphNode): Record<string, GraphNode> {
  const out: Record<string, GraphNode> = {};
  (function walk(node: GraphNode) {
    out[node.id] = node;
    (node.children ?? []).forEach(walk);
  })(n);
  return out;
}

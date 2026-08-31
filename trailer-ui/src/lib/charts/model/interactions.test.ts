import { describe, it, expect } from 'vitest';
import { ancestorsOf, enforceBudget, countVisible, computeFrame, easeOutCubic } from './interactions';
import type { GraphNode } from './layout';

function leaf(id: string): GraphNode {
  return { id, name: id.split('.').pop()!, kind: 'leaf', params: { total: 1, trainable: 1, self: 1, fmt: '1' } };
}

/** root → block containers b0..bn, each holding `per` leaves */
function fanout(blocks: number, per: number): GraphNode {
  return {
    id: 'root',
    name: 'root',
    kind: 'container',
    children: Array.from({ length: blocks }, (_, i) => ({
      id: `root.b${i}`,
      name: `b${i}`,
      kind: 'container',
      children: Array.from({ length: per }, (_, j) => leaf(`root.b${i}.l${j}`)),
    })),
  };
}

describe('ancestorsOf', () => {
  it('returns proper prefixes excluding self', () => {
    expect(ancestorsOf('root.model.layers.0')).toEqual(['root', 'root.model', 'root.model.layers']);
  });
  it('returns empty for the root', () => {
    expect(ancestorsOf('root')).toEqual([]);
  });
});

describe('countVisible', () => {
  it('counts every node when everything is open', () => {
    expect(countVisible(fanout(2, 3), new Set())).toBe(1 + 2 + 6);
  });
  it('hides subtrees of collapsed containers', () => {
    expect(countVisible(fanout(2, 3), new Set(['root.b0', 'root.b1']))).toBe(3);
  });
});

describe('enforceBudget', () => {
  it('evicts least-recently opened containers until under budget', () => {
    const tree = fanout(10, 5); // all open: 1 + 10 + 50 = 61 nodes
    const order = ['root.b0', 'root.b1', 'root.b2', 'root.b3', 'root.b4', 'root.b5', 'root.b6', 'root.b7', 'root.b8', 'root.b9'];
    const res = enforceBudget(tree, new Set(), order, 'root.b9', 30);
    // a collapsed container still shows itself (1 box); each eviction hides its
    // 5 leaves: 61 → 26 needs 7 evictions
    expect(res.evicted).toBe(7);
    for (const v of ['root.b0', 'root.b1', 'root.b2', 'root.b3', 'root.b4', 'root.b5', 'root.b6']) {
      expect(res.collapsed.has(v), `${v} should be evicted`).toBe(true);
    }
    // the just-opened container stays open
    expect(res.collapsed.has('root.b9')).toBe(false);
    // order keeps the survivors, oldest evicted first
    expect(res.order).toEqual(['root.b7', 'root.b8', 'root.b9']);
    expect(countVisible(tree, res.collapsed)).toBeLessThanOrEqual(30);
  });

  it('never evicts the opened container or its ancestors', () => {
    const tree: GraphNode = {
      id: 'root', name: 'root', kind: 'container',
      children: Array.from({ length: 8 }, (_, i) => ({
        id: `root.b${i}`, name: `b${i}`, kind: 'container',
        children: [leaf(`root.b${i}.l0`)],
      })),
    };
    // all open = 17; budget 10 needs 7 leaf-hiding evictions — every container
    // except the protected root.b1 gets evicted, root.b1 survives
    const order = Array.from({ length: 8 }, (_, i) => `root.b${i}`);
    const res = enforceBudget(tree, new Set(), order, 'root.b1', 10);
    expect(res.collapsed.has('root.b1')).toBe(false);
    expect(res.evicted).toBe(7);
  });

  it('is a no-op under budget', () => {
    const tree = fanout(2, 3);
    const res = enforceBudget(tree, new Set(['root.b1']), ['root.b0'], 'root.b0', 100);
    expect(res.evicted).toBe(0);
    expect(res.collapsed.has('root.b1')).toBe(true);
  });
});

describe('computeFrame', () => {
  it('fits the box into the viewport with padding and centers it', () => {
    const box = { x: 100, y: 100, w: 400, h: 200 };
    const t = computeFrame(box, 800, 600, 0.1, 2, 0.02);
    const usableW = 800 * 0.8, usableH = 600 * 0.8;
    expect(t.scale).toBeCloseTo(Math.min(usableW / 400, usableH / 200, 2), 5);
    expect(t.x + (box.x + box.w / 2) * t.scale).toBeCloseTo(400, 5);
    expect(t.y + (box.y + box.h / 2) * t.scale).toBeCloseTo(300, 5);
  });
  it('clamps scale to the maximum', () => {
    const t = computeFrame({ x: 0, y: 0, w: 50, h: 30 }, 800, 600, 0.1, 1.4, 0.02);
    expect(t.scale).toBeLessThanOrEqual(1.4);
  });
});

describe('easeOutCubic', () => {
  it('maps 0→0, 1→1 and eases past linear midpoints', () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
    expect(easeOutCubic(0.5)).toBeGreaterThan(0.5);
  });
});

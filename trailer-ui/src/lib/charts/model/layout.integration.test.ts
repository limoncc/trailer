import { describe, it, expect } from 'vitest';
import ELK from 'elkjs/lib/elk.bundled.js';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { layoutGraph, canvasMeasure, depthOf, indexTree } from './layout';
import type { Spec, GraphNode } from './layout';

const elk = new ELK();

/** Load the real SDK-produced trace graph (see trailer-sdk tests). */
async function loadFixture(): Promise<Spec> {
  const raw = await readFile(join(__dirname, 'fixtures', 'moe-trace-graph.json'), 'utf-8');
  return JSON.parse(raw) as Spec;
}

/** Mirror the component's defaultCollapse: containers at dot-depth >= 2 closed. */
function defaultCollapsed(tree: GraphNode): Set<string> {
  const out = new Set<string>();
  for (const id of Object.keys(indexTree(tree))) {
    if (depthOf(id) >= 2) out.add(id);
  }
  return out;
}


describe('layoutGraph on a real SDK trace fixture', () => {
  it('produces sane geometry for the default collapsed view', async () => {
    const spec = await loadFixture();
    const collapsed = defaultCollapsed(spec.tree);
    const r = await layoutGraph(spec, collapsed, { measure: canvasMeasure, elk });

    // every visible box present, coordinates finite
    // (default view: root, stem, layers, the collapsed rep block, head)
    const boxes = Object.values(r.boxes);
    expect(boxes.length).toBeGreaterThanOrEqual(5);
    for (const b of boxes) {
      expect(Number.isFinite(b.x)).toBe(true);
      expect(Number.isFinite(b.y)).toBe(true);
      expect(b.w).toBeGreaterThan(0);
      expect(b.h).toBeGreaterThan(0);
    }
    // routes: finite endpoints landing on (or within 2px of) their node boxes
    expect(r.routes.length).toBeGreaterThanOrEqual(2);
    for (const rt of r.routes) {
      const sb = r.boxes[rt.source];
      const tb = r.boxes[rt.target];
      expect(sb, `missing source box ${rt.source}`).toBeTruthy();
      expect(tb, `missing target box ${rt.target}`).toBeTruthy();
      const near = (px: number, py: number, b: { x: number; y: number; w: number; h: number }) =>
        px >= b.x - 2 && px <= b.x + b.w + 2 && py >= b.y - 2 && py <= b.y + b.h + 2;
      expect(near(rt.sx, rt.sy, sb), `route ${rt.source}->${rt.target} start off-box`).toBe(true);
      expect(near(rt.ex, rt.ey, tb), `route ${rt.source}->${rt.target} end off-box`).toBe(true);
    }
  });

  it('keeps geometry sane when the representative block is expanded', async () => {
    const spec = await loadFixture();
    const collapsed = defaultCollapsed(spec.tree);
    collapsed.delete('root.layers.0');
    const r = await layoutGraph(spec, collapsed, { measure: canvasMeasure, elk });
    // expanded block now shows its children (router/experts/shared/combine)
    expect(r.boxes['root.layers.0.router']).toBeTruthy();
    expect(r.boxes['root.layers.0.experts']).toBeTruthy();
    expect(r.boxes['root.layers.0.combine']).toBeTruthy();
    // MoE routing edges route between the visible block internals
    const routing = r.routes.filter((rt) => rt.kind === 'routing');
    expect(routing.length).toBeGreaterThanOrEqual(2);
    expect(routing.some((rt) => rt.shape === 'top-2/4')).toBe(true);
    expect(routing.some((rt) => rt.source === 'root.layers.0.router' && rt.target === 'root.layers.0.experts')).toBe(true);
    expect(routing.some((rt) => rt.target === 'root.layers.0.combine')).toBe(true);
    for (const rt of r.routes) {
      expect(Number.isFinite(rt.sx) && Number.isFinite(rt.ey)).toBe(true);
    }
  });
});

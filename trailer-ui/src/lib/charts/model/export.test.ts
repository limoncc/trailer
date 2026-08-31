import { describe, it, expect } from 'vitest';
import { buildSvg } from './export';
import type { LayoutResult } from './layout';

const layout: LayoutResult = {
  boxes: {
    root: { id: 'root', x: 0, y: 0, w: 200, h: 80, node: { id: 'root', name: 'root', kind: 'container', params: { total: 10, trainable: 10, self: 0, fmt: '10' } }, depth: 0 },
    'root.a': { id: 'root.a', x: 20, y: 30, w: 96, h: 44, node: { id: 'root.a', name: 'a', kind: 'linear', params: { total: 10, trainable: 10, self: 10, fmt: '10' } }, depth: 1 },
  },
  routes: [
    { source: 'root.a', target: 'root', kind: 'order', path: 'M 68 74 L 68 80', sx: 68, sy: 74, ex: 68, ey: 80, mx: 68, my: 77, arrowDir: 'down' },
  ],
  bounds: { minX: 0, minY: 0, maxX: 200, maxY: 80 },
};

const spec = { meta: { name: 'demo' }, tree: { id: 'root', name: 'root' }, edges: [] };

describe('buildSvg', () => {
  it('renders boxes with stable data-id hooks and routed edges', () => {
    const svg = buildSvg(layout, spec);
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('data-id="root.a"');
    expect(svg).toContain('d="M 68 74 L 68 80"');
    expect(svg.endsWith('</svg>')).toBe(true);
  });
  it('escapes XML-unsafe text', () => {
    const l = { ...layout, boxes: { ...layout.boxes, 'root.a': { ...layout.boxes['root.a'], node: { ...layout.boxes['root.a'].node, name: 'a<b>&c' } } } };
    const svg = buildSvg(l, spec);
    expect(svg).toContain('a&lt;b&gt;&amp;c');
    expect(svg).not.toContain('a<b>&c');
  });
  it('supports dark palette', () => {
    const light = buildSvg(layout, spec, { dark: false });
    const dark = buildSvg(layout, spec, { dark: true });
    expect(light).not.toBe(dark);
  });
});

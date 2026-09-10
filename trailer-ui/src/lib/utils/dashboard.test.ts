import { describe, it, expect } from 'vitest';
import {
  parseLayout,
  serializeLayout,
  defaultWidgets,
  defaultWidgetTitle,
  clampW,
  clampH,
  newWidgetId,
  type DashboardLayout,
} from './dashboard';

describe('parseLayout', () => {
  it('parses a valid v2 layout with all widget types', () => {
    const layout = {
      version: 2 as const,
      widgets: [
        { id: 'w1', type: 'line', metrics: [{ key: 'loss', context: '' }], w: 12, h: 10, smooth: 3 },
        { id: 'w2', type: 'hist', key: 'weights', context: 'layer0', w: 12, h: 9, step: 'latest' as const },
        { id: 'w3', type: 'figure', name: 'confusion', w: 4, h: 8 },
        { id: 'w4', type: 'text', name: 'notes', w: 4, h: 8 },
        { id: 'w5', type: 'table', tableId: 7, w: 14, h: 12 },
        { id: 'w6', type: 'media', mediaId: 3, w: 4, h: 8 },
      ],
    };
    const parsed = parseLayout(serializeLayout(layout));
    expect(parsed.version).toBe(2);
    expect(parsed.widgets).toHaveLength(6);
    expect(parsed.widgets[0]).toMatchObject({ type: 'line', smooth: 3, xKind: 'step' });
    expect(parsed.widgets[1]).toMatchObject({ type: 'hist', key: 'weights', context: 'layer0' });
    expect(parsed.widgets[4]).toMatchObject({ type: 'table', tableId: 7 });
    expect(parsed.widgets[5]).toMatchObject({ type: 'media', mediaId: 3 });
  });

  it('serializes as v2 regardless of input version', () => {
    const s = serializeLayout({ version: 1, widgets: [] });
    expect(JSON.parse(s).version).toBe(2);
  });

  it('migrates v1 (12-col) layouts by doubling widths', () => {
    const s = JSON.stringify({
      version: 1,
      widgets: [
        { id: 'w1', type: 'line', metrics: [{ key: 'a', context: '' }], w: 6, h: 10 },
        { id: 'w2', type: 'line', metrics: [{ key: 'b', context: '' }], w: 12, h: 8 },
      ],
    });
    const parsed = parseLayout(s);
    expect(parsed.version).toBe(2);
    expect(parsed.widgets[0].w).toBe(12);
    expect(parsed.widgets[1].w).toBe(24);
  });

  it('heals the legacy double-wrapped corrupt layout', () => {
    const s = JSON.stringify({
      version: 1,
      widgets: {
        version: 1,
        widgets: [{ id: 'w1', title: '熵监控', type: 'line', metrics: [{ key: 'entropy', context: 'train' }], w: 6, h: 8 }],
      },
    });
    const parsed = parseLayout(s);
    expect(parsed.widgets).toHaveLength(1);
    expect(parsed.widgets[0]).toMatchObject({ id: 'w1', title: '熵监控', w: 12 });
  });

  it('drops unknown widget types (forward compatibility)', () => {
    const s = JSON.stringify({
      version: 1,
      widgets: [
        { id: 'w1', type: 'line', metrics: [{ key: 'loss', context: '' }], w: 6, h: 10 },
        { id: 'wx', type: 'landscape-3d', payload: 'whatever' },
        { id: 'wy', type: 'mystery', w: 6, h: 6 },
      ],
    });
    const parsed = parseLayout(s);
    expect(parsed.widgets).toHaveLength(1);
    expect(parsed.widgets[0].id).toBe('w1');
  });

  it('heals slash-containing metric keys (first-slash split)', () => {
    const s = JSON.stringify({
      version: 1,
      widgets: [
        { id: 'w1', type: 'line', metrics: [{ key: 'eval/train', context: 'sr_d2' }], w: 6, h: 10 },
      ],
    });
    const parsed = parseLayout(s);
    const line = parsed.widgets[0] as any;
    expect(line.metrics[0]).toEqual({ key: 'eval', context: 'train/sr_d2' });
  });

  it('drops line widgets without metrics', () => {
    const s = JSON.stringify({
      version: 1,
      widgets: [
        { id: 'w1', type: 'line', metrics: [], w: 6, h: 10 },
        { id: 'w2', type: 'line', w: 6, h: 10 },
      ],
    });
    expect(parseLayout(s).widgets).toHaveLength(0);
  });

  it('clamps w/h into range and fills defaults', () => {
    const s = JSON.stringify({
      version: 2,
      widgets: [
        { id: 'w1', type: 'line', metrics: [{ key: 'a', context: '' }], w: 99, h: -5 },
        { id: 'w2', type: 'table', tableId: 1 },
      ],
    });
    const parsed = parseLayout(s);
    expect(parsed.widgets[0].w).toBe(24);
    expect(parsed.widgets[0].h).toBe(4);
    expect(parsed.widgets[1].w).toBe(12);
    expect(parsed.widgets[1].h).toBe(10);
  });

  it('assigns ids when missing and dedupes duplicates', () => {
    const s = JSON.stringify({
      version: 1,
      widgets: [
        { type: 'table', tableId: 1, w: 6, h: 8 },
        { id: 'dup', type: 'table', tableId: 2, w: 6, h: 8 },
        { id: 'dup', type: 'table', tableId: 3, w: 6, h: 8 },
      ],
    });
    const parsed = parseLayout(s);
    expect(parsed.widgets).toHaveLength(3);
    const ids = new Set(parsed.widgets.map((w) => w.id));
    expect(ids.size).toBe(3);
  });

  it('returns empty layout for invalid JSON / wrong shapes / null', () => {
    expect(parseLayout('not json').widgets).toHaveLength(0);
    expect(parseLayout('{"widgets": 5}').widgets).toHaveLength(0);
    expect(parseLayout('null').widgets).toHaveLength(0);
    expect(parseLayout(undefined).widgets).toHaveLength(0);
    expect(parseLayout('').widgets).toHaveLength(0);
  });

  it('normalizes xKind and smooth', () => {
    const s = JSON.stringify({
      version: 2,
      widgets: [
        { id: 'w1', type: 'line', metrics: [{ key: 'a', context: '' }], xKind: 'wall_time', smooth: 99 },
        { id: 'w2', type: 'line', metrics: [{ key: 'a', context: '' }], smooth: 0, yLog: true },
      ],
    });
    const parsed = parseLayout(s);
    expect(parsed.widgets[0]).toMatchObject({ xKind: 'wall_time', smooth: 20 });
    expect(parsed.widgets[1]).toMatchObject({ smooth: undefined, yLog: true });
  });
});

describe('clamp helpers', () => {
  it('clampW bounds (24-col grid)', () => {
    expect(clampW(1)).toBe(3);
    expect(clampW(13)).toBe(13);
    expect(clampW(99)).toBe(24);
    expect(clampW(NaN)).toBe(12);
    expect(clampW(undefined, 8)).toBe(8);
  });

  it('clampH bounds', () => {
    expect(clampH(0)).toBe(4);
    expect(clampH(999)).toBe(40);
    expect(clampH(undefined, 8)).toBe(8);
  });
});

describe('defaultWidgetTitle', () => {
  it('joins line metrics with display fn', () => {
    expect(
      defaultWidgetTitle(
        { id: 'w', type: 'line', metrics: [{ key: 'loss', context: '' }, { key: 'gpu_util', context: 'system/nvidia/gpu0' }], w: 6, h: 8 },
        (m) => (m.context ? `${m.context}/${m.key}` : m.key)
      )
    ).toBe('loss | system/nvidia/gpu0/gpu_util');
  });

  it('falls back to key[context] format', () => {
    expect(
      defaultWidgetTitle({ id: 'w', type: 'hist', key: 'act', context: 'layer1', w: 6, h: 8 })
    ).toBe('act [layer1]');
    expect(
      defaultWidgetTitle({ id: 'w', type: 'hist', key: 'act', context: '', w: 6, h: 8 })
    ).toBe('act');
  });

  it('table/media titles use id', () => {
    expect(defaultWidgetTitle({ id: 'w', type: 'table', tableId: 9, w: 6, h: 8 })).toBe('Table #9');
    expect(defaultWidgetTitle({ id: 'w', type: 'media', mediaId: 2, w: 6, h: 8 })).toBe('Media #2');
  });
});

describe('defaultWidgets', () => {
  it('groups metrics by context into line widgets', () => {
    const metrics = [
      { key: 'loss', context: '' },
      { key: 'lr', context: '' },
      { key: 'gpu_util', context: 'system/nvidia/gpu0' },
    ];
    const widgets = defaultWidgets(metrics);
    expect(widgets).toHaveLength(2);
    const root = widgets.find((w) => (w as any).metrics.length === 2);
    expect(root).toMatchObject({ type: 'line', w: 12, h: 10 });
  });

  it('splits large contexts into chunks of 8', () => {
    const metrics = Array.from({ length: 10 }, (_, i) => ({ key: `m${i}`, context: '' }));
    const widgets = defaultWidgets(metrics);
    expect(widgets).toHaveLength(2);
    expect((widgets[0] as any).metrics).toHaveLength(8);
    expect((widgets[1] as any).metrics).toHaveLength(2);
  });

  it('returns empty for no metrics', () => {
    expect(defaultWidgets([])).toHaveLength(0);
  });
});

describe('newWidgetId', () => {
  it('generates unique prefixed ids', () => {
    const a = newWidgetId();
    const b = newWidgetId();
    expect(a).toMatch(/^w_[0-9a-f]+$/);
    expect(a).not.toBe(b);
  });
});

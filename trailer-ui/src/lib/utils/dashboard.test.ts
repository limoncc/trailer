import { describe, it, expect } from 'vitest';
import {
  parseLayout,
  serializeLayout,
  defaultWidgets,
  defaultWidgetTitle,
  defaultSize,
  clampW,
  clampH,
  minSize,
  computeSnapSeams,
  MIN_H,
  MIN_W,
  newWidgetId,
  type DashboardLayout,
  type SnapDir,
} from './dashboard';

describe('parseLayout', () => {
  it('parses a valid v3 layout with all widget types', () => {
    const layout = {
      version: 3 as const,
      widgets: [
        { id: 'w1', type: 'line', metrics: [{ key: 'loss', context: '' }], w: 18, h: 10, smooth: 3 },
        { id: 'w2', type: 'hist', key: 'weights', context: 'layer0', w: 18, h: 9, step: 'latest' as const },
        { id: 'w3', type: 'figure', name: 'confusion', w: 6, h: 8 },
        { id: 'w4', type: 'text', name: 'notes', w: 6, h: 8 },
        { id: 'w5', type: 'table', tableId: 7, w: 21, h: 12 },
        { id: 'w6', type: 'media', mediaId: 3, w: 6, h: 8 },
      ],
    };
    const parsed = parseLayout(serializeLayout(layout));
    expect(parsed.version).toBe(3);
    expect(parsed.widgets).toHaveLength(6);
    expect(parsed.widgets[0]).toMatchObject({ type: 'line', smooth: 3, xKind: 'step', w: 18 });
    expect(parsed.widgets[1]).toMatchObject({ type: 'hist', key: 'weights', context: 'layer0' });
    expect(parsed.widgets[4]).toMatchObject({ type: 'table', tableId: 7 });
    expect(parsed.widgets[5]).toMatchObject({ type: 'media', mediaId: 3 });
  });

  it('serializes as v3 regardless of input version', () => {
    const s = serializeLayout({ version: 1, widgets: [] });
    expect(JSON.parse(s).version).toBe(3);
  });

  it('migrates v1 (12-col) widths ×3 and v2 (24-col) widths ×1.5', () => {
    const s = JSON.stringify({
      version: 1,
      widgets: [
        { id: 'w1', type: 'line', metrics: [{ key: 'a', context: '' }], w: 6, h: 10 },
        { id: 'w2', type: 'line', metrics: [{ key: 'b', context: '' }], w: 12, h: 8 },
      ],
    });
    const parsed = parseLayout(s);
    expect(parsed.version).toBe(3);
    expect(parsed.widgets[0].w).toBe(18);
    expect(parsed.widgets[1].w).toBe(36);

    const s2 = JSON.stringify({
      version: 2,
      widgets: [
        { id: 'w1', type: 'line', metrics: [{ key: 'a', context: '' }], w: 12, h: 10 },
        { id: 'w2', type: 'line', metrics: [{ key: 'b', context: '' }], w: 24, h: 8 },
      ],
    });
    const parsed2 = parseLayout(s2);
    expect(parsed2.widgets[0].w).toBe(18);
    expect(parsed2.widgets[1].w).toBe(36);
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
    expect(parsed.widgets[0]).toMatchObject({ id: 'w1', title: '熵监控', w: 18 });
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
      version: 3,
      widgets: [
        { id: 'w1', type: 'line', metrics: [{ key: 'a', context: '' }], w: 99, h: -5 },
        { id: 'w2', type: 'table', tableId: 1 },
      ],
    });
    const parsed = parseLayout(s);
    expect(parsed.widgets[0].w).toBe(36);
    expect(parsed.widgets[0].h).toBe(2);
    expect(parsed.widgets[1].w).toBe(12);
    expect(parsed.widgets[1].h).toBe(4);
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

  it('keeps valid header color and drops invalid ones', () => {
    const s = JSON.stringify({
      version: 2,
      widgets: [
        { id: 'w1', type: 'table', tableId: 1, color: '#FF00Aa' },
        { id: 'w2', type: 'table', tableId: 2, color: 'red' },
        { id: 'w3', type: 'table', tableId: 3, color: '#12345' },
        { id: 'w4', type: 'table', tableId: 4 },
      ],
    });
    const parsed = parseLayout(s);
    expect(parsed.widgets[0].color).toBe('#ff00aa');
    expect(parsed.widgets[1].color).toBeUndefined();
    expect(parsed.widgets[2].color).toBeUndefined();
    expect(parsed.widgets[3].color).toBeUndefined();
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
  it('clampW bounds (36-col grid)', () => {
    expect(clampW(1)).toBe(3);
    expect(clampW(13)).toBe(13);
    expect(clampW(99)).toBe(36);
    expect(clampW(NaN)).toBe(12);
    expect(clampW(undefined, 8)).toBe(8);
  });

  it('clampH bounds', () => {
    expect(clampH(0)).toBe(2);
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

  it('pca title uses figure name', () => {
    expect(defaultWidgetTitle({ id: 'w', type: 'pca', name: 'tok_emb', w: 6, h: 8 })).toBe('tok_emb');
  });

  it('landscape title uses figure name', () => {
    expect(defaultWidgetTitle({ id: 'w', type: 'landscape', name: 'loss_landscape', w: 6, h: 8 })).toBe('loss_landscape');
  });
});

describe('landscape widgets', () => {
  it('parses landscape widget with name and optional step, round-trips', () => {
    const s = JSON.stringify({
      version: 3,
      widgets: [
        { id: 'w1', type: 'landscape', name: 'loss_landscape', w: 12, h: 7 },
        { id: 'w2', type: 'landscape', name: 'proj', step: 10, w: 12, h: 7 },
      ],
    });
    const parsed = parseLayout(s);
    expect(parsed.widgets).toHaveLength(2);
    expect(parsed.widgets[0]).toMatchObject({ type: 'landscape', name: 'loss_landscape' });
    expect(parsed.widgets[1]).toMatchObject({ type: 'landscape', name: 'proj', step: 10 });
    const again = parseLayout(serializeLayout(parsed));
    expect(again.widgets[0]).toMatchObject({ type: 'landscape', name: 'loss_landscape' });
  });

  it('drops landscape widgets without a name', () => {
    const s = JSON.stringify({
      version: 3,
      widgets: [
        { id: 'w1', type: 'landscape', w: 12, h: 7 },
        { id: 'w2', type: 'landscape', name: '', w: 12, h: 7 },
      ],
    });
    expect(parseLayout(s).widgets).toHaveLength(0);
  });

  it('defaultSize landscape is 12x7', () => {
    expect(defaultSize('landscape')).toEqual({ w: 12, h: 7 });
  });

  it('WIDGET_TYPES registers Landscape tab', async () => {
    const { WIDGET_TYPES } = await import('./widgetTypes');
    const ls = WIDGET_TYPES.find((t) => t.type === 'landscape');
    expect(ls).toBeDefined();
    expect(ls!.label).toBe('Landscape');
  });
});

describe('pca widgets', () => {
  it('parses pca widget with name and optional step, round-trips', () => {
    const s = JSON.stringify({
      version: 3,
      widgets: [
        { id: 'w1', type: 'pca', name: 'tok_emb', w: 12, h: 6 },
        { id: 'w2', type: 'pca', name: 'w_q', step: 42, w: 12, h: 6 },
      ],
    });
    const parsed = parseLayout(s);
    expect(parsed.widgets).toHaveLength(2);
    expect(parsed.widgets[0]).toMatchObject({ type: 'pca', name: 'tok_emb' });
    expect(parsed.widgets[1]).toMatchObject({ type: 'pca', name: 'w_q', step: 42 });
    // 往返:序列化后再解析保持一致
    const again = parseLayout(serializeLayout(parsed));
    expect(again.widgets[0]).toMatchObject({ type: 'pca', name: 'tok_emb' });
  });

  it('drops pca widgets without a name', () => {
    const s = JSON.stringify({
      version: 3,
      widgets: [
        { id: 'w1', type: 'pca', w: 12, h: 6 },
        { id: 'w2', type: 'pca', name: '', w: 12, h: 6 },
      ],
    });
    expect(parseLayout(s).widgets).toHaveLength(0);
  });

  it('defaultSize pca is 12x7 and hist fits its explorer (12x8)', () => {
    expect(defaultSize('pca')).toEqual({ w: 12, h: 7 });
    expect(defaultSize('hist')).toEqual({ w: 12, h: 8 });
  });

  it('WIDGET_TYPES registers PCA tab', async () => {
    const { WIDGET_TYPES } = await import('./widgetTypes');
    const pca = WIDGET_TYPES.find((t) => t.type === 'pca');
    expect(pca).toBeDefined();
    expect(pca!.label).toBe('PCA');
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
    expect(root).toMatchObject({ type: 'line', w: 12, h: 4 });
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

describe('info widgets', () => {
  const layout = {
    version: 3 as const,
    widgets: [
      {
        id: 'info1',
        type: 'info',
        w: 9,
        h: 6,
        gpus: 8,
        unitPrice: 6.5,
        modelPath: 'run.model_name',
        items: [
          { src: 'status' },
          { src: 'step' },
          { src: 'cost' },
          { src: 'config', path: 'train.lr', label: 'lr' },
          { src: 'metric', key: 'loss', context: 'train' },
          { src: 'bogus' },
        ],
      },
    ],
  };

  it('parses info widgets with items tolerantly', () => {
    const parsed = parseLayout(JSON.stringify(layout));
    expect(parsed.widgets).toHaveLength(1);
    const w = parsed.widgets[0] as any;
    expect(w.type).toBe('info');
    expect(w.gpus).toBe(8);
    expect(w.unitPrice).toBe(6.5);
    expect(w.modelPath).toBe('run.model_name');
    // step/elapsed 由卡片头部固定展示,items 里丢弃;未知 src 丢弃
    // step/elapsed(旧版遗留)丢弃;status/cost/config/metric 保留且顺序不变
    expect(w.items.map((i: any) => i.src)).toEqual(['status', 'cost', 'config', 'metric']);
    expect(w.items[2]).toMatchObject({ path: 'train.lr', label: 'lr' });
    expect(w.items[3]).toMatchObject({ key: 'loss', context: 'train' });
  });

  it('drops invalid gpus/unitPrice', () => {
    const bad = JSON.parse(JSON.stringify(layout));
    bad.widgets[0].gpus = -3;
    bad.widgets[0].unitPrice = 'free';
    const parsed = parseLayout(JSON.stringify(bad));
    expect((parsed.widgets[0] as any).gpus).toBeUndefined();
    expect((parsed.widgets[0] as any).unitPrice).toBeUndefined();
  });

  it('round-trips through serializeLayout', () => {
    const parsed = parseLayout(JSON.stringify(layout));
    const again = parseLayout(serializeLayout(parsed));
    expect(again.widgets[0]).toMatchObject({ type: 'info', gpus: 8, unitPrice: 6.5, modelPath: 'run.model_name' });
    expect((again.widgets[0] as any).items).toHaveLength(4);
  });

  it('parses snap directions; legacy string/bool migrate to arrays', () => {
    const parsed = parseLayout(JSON.stringify({
      version: 3,
      widgets: [
        { id: 'a', type: 'line', metrics: [{ key: 'a', context: '' }], w: 12, h: 4, snap: ['up', 'left', 'up', 'diag'] },
        { id: 'b', type: 'line', metrics: [{ key: 'b', context: '' }], w: 12, h: 4, snap: 'up' },
        { id: 'c', type: 'line', metrics: [{ key: 'c', context: '' }], w: 12, h: 4, snapPrev: true },
        { id: 'd', type: 'line', metrics: [{ key: 'd', context: '' }], w: 12, h: 4, snap: 'diagonal' },
        { id: 'e', type: 'line', metrics: [{ key: 'e', context: '' }], w: 12, h: 4 },
      ],
    }));
    expect(parsed.widgets[0].snap).toEqual(['up', 'left']);
    expect(parsed.widgets[1].snap).toEqual(['up']);
    expect(parsed.widgets[2].snap).toEqual(['left']);
    expect(parsed.widgets[3].snap).toBeUndefined();
    expect(parsed.widgets[4].snap).toBeUndefined();
  });

  it('round-trips snap arrays through serializeLayout', () => {
    const parsed = parseLayout(JSON.stringify({
      version: 3,
      widgets: [{ id: 'a', type: 'line', metrics: [{ key: 'a', context: '' }], w: 12, h: 4, snap: ['up', 'right'] }],
    }));
    const again = parseLayout(serializeLayout(parsed));
    expect(again.widgets[0].snap).toEqual(['up', 'right']);
  });

  it('parses info currency (usd default dropped, cny kept, others dropped)', () => {
    const parsed = parseLayout(JSON.stringify({
      version: 3,
      widgets: [
        { id: 'i1', type: 'info', w: 9, h: 6, items: [{ src: 'cost' }], currency: 'cny' },
        { id: 'i2', type: 'info', w: 9, h: 6, items: [{ src: 'cost' }], currency: 'eur' },
        { id: 'i3', type: 'info', w: 9, h: 6, items: [{ src: 'cost' }] },
      ],
    }));
    expect((parsed.widgets[0] as any).currency).toBe('cny');
    expect((parsed.widgets[1] as any).currency).toBeUndefined();
    expect((parsed.widgets[2] as any).currency).toBeUndefined();
    const again = parseLayout(serializeLayout(parsed));
    expect((again.widgets[0] as any).currency).toBe('cny');
  });

  it('parses cost item label and widget modelLabel (display rename)', () => {
    const parsed = parseLayout(JSON.stringify({
      version: 3,
      widgets: [
        {
          id: 'i1', type: 'info', w: 9, h: 6,
          items: [{ src: 'cost', label: 'GPU 花费' }, { src: 'status' }],
          modelLabel: 'My Model',
        },
        { id: 'i2', type: 'info', w: 9, h: 6, items: [{ src: 'cost' }] },
      ],
    }));
    expect((parsed.widgets[0] as any).items[0]).toEqual({ src: 'cost', label: 'GPU 花费' });
    expect((parsed.widgets[0] as any).modelLabel).toBe('My Model');
    // 空白 modelLabel 丢弃
    const blank = parseLayout(JSON.stringify({
      version: 3,
      widgets: [{ id: 'i', type: 'info', w: 9, h: 6, items: [{ src: 'cost' }], modelLabel: '   ' }],
    }));
    expect((blank.widgets[0] as any).modelLabel).toBeUndefined();
    const again = parseLayout(serializeLayout(parsed));
    expect((again.widgets[0] as any).items[0]).toEqual({ src: 'cost', label: 'GPU 花费' });
    expect((again.widgets[0] as any).modelLabel).toBe('My Model');
  });

  it('parses hFixed (manual height) only as true', () => {
    const parsed = parseLayout(JSON.stringify({
      version: 3,
      widgets: [
        { id: 'a', type: 'info', w: 9, h: 8, items: [{ src: 'cost' }], hFixed: true },
        { id: 'b', type: 'info', w: 9, h: 6, items: [{ src: 'cost' }], hFixed: false },
        { id: 'c', type: 'info', w: 9, h: 6, items: [{ src: 'cost' }] },
      ],
    }));
    expect((parsed.widgets[0] as any).hFixed).toBe(true);
    expect((parsed.widgets[1] as any).hFixed).toBeUndefined();
    expect((parsed.widgets[2] as any).hFixed).toBeUndefined();
    const again = parseLayout(serializeLayout(parsed));
    expect((again.widgets[0] as any).hFixed).toBe(true);
  });

  it('parses line card filter (Select/Exclude state) with roundtrip', () => {
    const filter = {
      brushMode: 'exclude',
      xWindow: [15, 35],
      excludeRanges: [[0, 5], [90, 100]],
      excludePoints: ['acc 20'],
    };
    const parsed = parseLayout(JSON.stringify({
      version: 3,
      widgets: [
        { id: 'l1', type: 'line', w: 9, h: 6, metrics: [{ key: 'loss', context: '' }], filter },
        { id: 'l2', type: 'line', w: 9, h: 6, metrics: [{ key: 'loss', context: '' }] },
      ],
    }));
    expect((parsed.widgets[0] as any).filter).toEqual(filter);
    expect((parsed.widgets[1] as any).filter).toBeUndefined();
    const again = parseLayout(serializeLayout(parsed));
    expect((again.widgets[0] as any).filter).toEqual(filter);
  });

  it('line card filter: 容错白名单与非法载荷丢弃', () => {
    const parsed = parseLayout(JSON.stringify({
      version: 3,
      widgets: [
        {
          id: 'l1', type: 'line', w: 9, h: 6, metrics: [{ key: 'loss', context: '' }],
          filter: {
            brushMode: 'bogus',
            xWindow: [NaN, 1],
            excludeRanges: [[1, 2], ['a'], [3]],
            excludePoints: ['a 1', 42, null],
          },
        },
        {
          id: 'l2', type: 'line', w: 9, h: 6, metrics: [{ key: 'loss', context: '' }],
          filter: 'not-object',
        },
      ],
    }));
    expect((parsed.widgets[0] as any).filter).toEqual({
      excludeRanges: [[1, 2]],
      excludePoints: ['a 1'],
    });
    expect((parsed.widgets[1] as any).filter).toBeUndefined();
  });

  it('defaultSize and defaultWidgetTitle', () => {
    expect(defaultSize('info')).toEqual({ w: 9, h: 6 });
    expect(defaultWidgetTitle({ id: 'i', type: 'info', items: [], w: 9, h: 6 })).toBe('Training Info');
  });
});

describe('minSize', () => {
  it('info cards keep a compact floor', () => {
    expect(minSize('info')).toEqual({ w: 3, h: 2 });
  });

  it('other types keep the global floor', () => {
    expect(minSize('line')).toEqual({ w: MIN_W, h: MIN_H });
    expect(minSize('media')).toEqual({ w: MIN_W, h: MIN_H });
  });

  it('parse bumps undersized info cards to the floor', () => {
    const parsed = parseLayout(JSON.stringify({
      version: 3,
      widgets: [{ id: 'i', type: 'info', items: [{ src: 'status' }], w: 2, h: 2 }],
    }));
    expect(parsed.widgets[0]).toMatchObject({ type: 'info', w: 3, h: 2 });
  });
});

describe('layout compact (snap)', () => {
  it('parses compact flag and defaults to false', () => {
    const on = parseLayout(JSON.stringify({ version: 3, widgets: [], compact: true }));
    expect(on.compact).toBe(true);
    const off = parseLayout(JSON.stringify({ version: 3, widgets: [] }));
    expect(off.compact).toBe(false);
  });

  it('round-trips compact through serializeLayout', () => {
    const again = parseLayout(serializeLayout({ version: 3, widgets: [], compact: true }));
    expect(again.compact).toBe(true);
  });
});

describe('computeSnapSeams', () => {
  const line = (id: string, w: number, h: number, snap?: SnapDir[]) =>
    ({ id, type: 'line' as const, metrics: [{ key: id, context: '' }], w, h, snap });

  it('left snap: declarer drops left border, neighbor squares right corners', () => {
    const seams = computeSnapSeams([line('a', 6, 4), line('b', 6, 4, ['left'])]);
    expect(seams.get('b')).toEqual({ deborder: ['left'], square: ['left'] });
    expect(seams.get('a')).toEqual({ deborder: [], square: ['right'] });
  });

  it('up+left combo: up has no neighbor at top row (no deborder), left seam works', () => {
    const seams = computeSnapSeams([line('a', 6, 8), line('b', 6, 4, ['up', 'left'])]);
    expect(seams.get('b')).toEqual({ deborder: ['left'], square: ['up', 'left'] });
    expect(seams.get('a')).toEqual({ deborder: [], square: ['right'] });
  });

  it('mutual snap: both sides drop their borders (fully merged seam)', () => {
    const seams = computeSnapSeams([line('a', 6, 4, ['right']), line('b', 6, 4, ['left'])]);
    expect(seams.get('a')).toEqual({ deborder: ['right'], square: ['right'] });
    expect(seams.get('b')).toEqual({ deborder: ['left'], square: ['left'] });
  });

  it('snap toward empty space squares but keeps the border', () => {
    const seams = computeSnapSeams([line('a', 6, 4, ['up'])]);
    expect(seams.get('a')).toEqual({ deborder: [], square: ['up'] });
  });

  it('up snap squares ALL cards above, not just the first', () => {
    // a+b+f 填满一行,c(宽14)跨在 a|b 拼缝正下方:两卡的底角都要改直角
    const seams = computeSnapSeams([line('a', 6, 3), line('b', 8, 3), line('f', 22, 3), line('c', 14, 3, ['up'])]);
    expect(seams.get('c')).toEqual({ deborder: ['up'], square: ['up'] });
    expect(seams.get('a')).toEqual({ deborder: [], square: ['down'] });
    expect(seams.get('b')).toEqual({ deborder: [], square: ['down'] });
    expect(seams.get('f')).toEqual({ deborder: [], square: [] });
  });

  it('up snap squares the card above downward', () => {
    // a 满宽占满第一行,b 才会被挤到下一行
    const seams = computeSnapSeams([line('a', 36, 2), line('b', 12, 2, ['up'])]);
    expect(seams.get('b')).toEqual({ deborder: ['up'], square: ['up'] });
    expect(seams.get('a')).toEqual({ deborder: [], square: ['down'] });
  });

  it('uses provided effective heights for vertical adjacency', () => {
    // b 存储高度 4,实际渲染 2:heights 覆盖后才与 a(2 行)贴行
    const seams = computeSnapSeams(
      [line('a', 36, 2), line('b', 12, 4, ['up'])],
      new Map([['b', 2]])
    );
    expect(seams.get('b')).toEqual({ deborder: ['up'], square: ['up'] });
    expect(seams.get('a')).toEqual({ deborder: [], square: ['down'] });
  });
});

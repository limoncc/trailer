import { describe, it, expect } from 'vitest';
import {
  normalizeValue,
  computeAxisScales,
  metricColor,
  buildLinePoints,
  buildChartLayout,
  pointsToPath,
} from './parallelUtils';

describe('normalizeValue', () => {
  it('端点映射到 0 和 1', () => {
    expect(normalizeValue(0, 0, 100)).toBe(0);
    expect(normalizeValue(100, 0, 100)).toBe(1);
  });

  it('中间值线性插值', () => {
    expect(normalizeValue(50, 0, 100)).toBe(0.5);
    expect(normalizeValue(25, 0, 100)).toBe(0.25);
  });

  it('min===max 时返回 0.5(防除零)', () => {
    expect(normalizeValue(5, 5, 5)).toBe(0.5);
  });

  it('支持负值/偏移范围', () => {
    expect(normalizeValue(-10, -20, 0)).toBe(0.5);
    expect(normalizeValue(10, 10, 20)).toBe(0);
  });
});

describe('computeAxisScales', () => {
  it('计算每维度 min/max', () => {
    const data = [
      { lr: 0.1, batch: 32 },
      { lr: 0.01, batch: 64 },
      { lr: 0.001, batch: 64 },
    ];
    expect(computeAxisScales(data, ['lr', 'batch'])).toEqual({
      lr: { min: 0.001, max: 0.1 },
      batch: { min: 32, max: 64 },
    });
  });

  it('过滤非数值字段', () => {
    const data = [
      { a: 1, name: 'x' },
      { a: 5, name: 'y' },
      { a: 'skip', name: 'z' },
    ];
    expect(computeAxisScales(data, ['a', 'name'])).toEqual({
      a: { min: 1, max: 5 },
      name: { min: 0, max: 1 }, // 无有效数值 → 默认
    });
  });

  it('单值维度 min===max', () => {
    expect(computeAxisScales([{ a: 7 }, { a: 7 }], ['a'])).toEqual({ a: { min: 7, max: 7 } });
  });

  it('空数据/空维度', () => {
    expect(computeAxisScales([], ['a'])).toEqual({ a: { min: 0, max: 1 } });
    expect(computeAxisScales([{ a: 1 }], [])).toEqual({});
  });
});

describe('metricColor', () => {
  it('低值端点蓝色 #3b82f6', () => {
    expect(metricColor(0, 0, 100)).toBe('rgb(59 130 246)');
  });

  it('高值端点红色 #ef4444', () => {
    expect(metricColor(100, 0, 100)).toBe('rgb(239 68 68)');
  });

  it('中间值线性混合', () => {
    // t=0.5: r=149, g=99, b=157
    expect(metricColor(50, 0, 100)).toBe('rgb(149 99 157)');
  });

  it('越界值被钳制到端点色', () => {
    expect(metricColor(-10, 0, 100)).toBe('rgb(59 130 246)');
    expect(metricColor(200, 0, 100)).toBe('rgb(239 68 68)');
  });

  it('min===max 时取中间色', () => {
    expect(metricColor(5, 5, 5)).toBe('rgb(149 99 157)');
  });
});

describe('buildLinePoints', () => {
  const layout = {
    axes: [
      { dim: 'lr', x: 100 },
      { dim: 'batch', x: 200 },
    ],
    plotTop: 30,
    plotBottom: 390,
    labelWidth: 90,
  };
  const scales = { lr: { min: 0, max: 0.1 }, batch: { min: 32, max: 64 } };

  it('把每维度值映射为折线点', () => {
    const pts = buildLinePoints({ lr: 0.05, batch: 48 }, ['lr', 'batch'], scales, layout);
    // plotH=360; lr:0.5→210; batch:0.5→210
    expect(pts).toEqual([
      { x: 100, y: 210 },
      { x: 200, y: 210 },
    ]);
  });

  it('低值在底部,高值在顶部', () => {
    const pts = buildLinePoints({ lr: 0, batch: 64 }, ['lr', 'batch'], scales, layout);
    expect(pts[0].y).toBe(390);
    expect(pts[1].y).toBe(30);
  });

  it('非数值维度返回 NaN 占位', () => {
    const pts = buildLinePoints({ lr: 'bad', batch: 48 }, ['lr', 'batch'], scales, layout);
    expect(Number.isNaN(pts[0].x)).toBe(true);
    expect(pts[1]).toEqual({ x: 200, y: 210 });
  });
});

describe('buildChartLayout', () => {
  it('轴在绘图区等距分布', () => {
    const layout = buildChartLayout(500, 420, ['a', 'b', 'c']);
    // labelWidth=90, padRight=24 → plotW=386
    expect(layout.axes.map((a) => a.x)).toEqual([90, 90 + 193, 90 + 386]);
    expect(layout.labelWidth).toBe(90);
    expect(layout.plotTop).toBe(40);
    expect(layout.plotBottom).toBe(392);
  });

  it('单维度轴居中', () => {
    const layout = buildChartLayout(500, 420, ['a']);
    expect(layout.axes).toEqual([{ dim: 'a', x: 90 + (500 - 90 - 24) / 2 }]);
  });

  it('空维度返回空轴', () => {
    expect(buildChartLayout(500, 420, []).axes).toEqual([]);
  });
});

describe('pointsToPath', () => {
  it('生成连续折线 path', () => {
    expect(pointsToPath([{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 20, y: 0 }])).toBe('M 0 0 L 10 10 L 20 0');
  });

  it('NaN 段用 M 重新开始', () => {
    expect(pointsToPath([{ x: 0, y: 0 }, { x: NaN, y: NaN }, { x: 20, y: 10 }])).toBe('M 0 0 M 20 10');
  });

  it('全 NaN / 空数组返回 null', () => {
    expect(pointsToPath([{ x: NaN, y: NaN }])).toBe(null);
    expect(pointsToPath([])).toBe(null);
  });
});

import { describe, it, expect, beforeEach } from 'vitest';
import { filterLineData, findNearestDatum, pointKey, toNum, loadFilterState, saveFilterState } from './lineFilter';

const rows = [
  { step: 0, value: 1.0, series: 'a' },
  { step: 10, value: 0.8, series: 'a' },
  { step: 20, value: 0.6, series: 'a' },
  { step: 30, value: 0.5, series: 'a' },
  { step: 40, value: 35.0, series: 'a' }, // 异常高点
  { step: 50, value: 0.3, series: 'a' },
];

describe('lineFilter 纯函数', () => {
  it('pointKey 区分 series 与 x', () => {
    expect(pointKey('a', 10)).toBe('a 10');
    expect(pointKey(null, 10)).toBe(' 10');
    expect(pointKey('a', 10)).not.toBe(pointKey('b', 10));
    expect(pointKey('a', 10)).not.toBe(pointKey('a', 11));
  });

  it('toNum: Date → ms, number 原样', () => {
    const d = new Date(1700000000000);
    expect(toNum(d)).toBe(1700000000000);
    expect(toNum(42)).toBe(42);
  });

  it('无过滤状态时原样返回同一引用', () => {
    const out = filterLineData(rows, { xField: 'step' });
    expect(out).toBe(rows);
  });

  it('xWindow 只保留窗口内（含边界）', () => {
    const out = filterLineData(rows, { xField: 'step', xWindow: [10, 30] });
    expect(out.map((r) => r.step)).toEqual([10, 20, 30]);
  });

  it('xWindow 反序输入自动纠正', () => {
    const out = filterLineData(rows, { xField: 'step', xWindow: [30, 10] });
    expect(out.map((r) => r.step)).toEqual([10, 20, 30]);
  });

  it('excludeRanges 排除区段（含边界、多段、反序归一）', () => {
    const out = filterLineData(rows, {
      xField: 'step',
      excludeRanges: [
        [35, 45], // 排除 40（异常点）
        [5, 0], // 反序 → [0,5]，含边界排除 step 0
      ],
    });
    expect(out.map((r) => r.step)).toEqual([10, 20, 30, 50]);
  });

  it('excludePoints 按 (series, x) 排除单点', () => {
    const pts = new Set([pointKey('a', 20)]);
    const out = filterLineData(rows, { xField: 'step', seriesField: 'series', excludePoints: pts });
    expect(out.map((r) => r.step)).toEqual([0, 10, 30, 40, 50]);
  });

  it('xWindow 与排除叠加（先窗口后排除）', () => {
    const out = filterLineData(rows, {
      xField: 'step',
      seriesField: 'series',
      xWindow: [10, 50],
      excludeRanges: [[35, 45]],
      excludePoints: new Set([pointKey('a', 20)]),
    });
    expect(out.map((r) => r.step)).toEqual([10, 30, 50]);
  });

  it('Date x 值与 ms 窗口比较（time 轴）', () => {
    const t = [
      { step: new Date(1000), value: 1 },
      { step: new Date(2000), value: 2 },
      { step: new Date(3000), value: 3 },
    ];
    const out = filterLineData(t, { xField: 'step', xWindow: [1500, 2500] });
    expect(out.map((r) => +r.step)).toEqual([2000]);
  });

  it('空数组与全排除边界', () => {
    expect(filterLineData([], { xField: 'step', xWindow: [0, 1] })).toEqual([]);
    const all = filterLineData(rows, { xField: 'step', xWindow: [100, 200] });
    expect(all).toEqual([]);
  });

  it('findNearestDatum: 归一化距离最近点（含 y 区分多 series）', () => {
    const multi = [
      { step: 10, value: 1, series: 'a' },
      { step: 10, value: 9, series: 'b' },
      { step: 20, value: 1, series: 'a' },
    ];
    const hit = findNearestDatum(multi, {
      xField: 'step',
      yField: 'value',
      clickX: 10,
      clickY: 8.5,
      xMin: 10,
      xMax: 20,
      yMin: 1,
      yMax: 9,
    });
    expect(hit).toEqual({ step: 10, value: 9, series: 'b' });
  });

  it('findNearestDatum: 空数据/非法值返回 null 或跳过', () => {
    const base = { xField: 'step', yField: 'value', clickX: 0, clickY: 0, xMin: 0, xMax: 1, yMin: 0, yMax: 1 };
    expect(findNearestDatum([], base)).toBeNull();
    const bad = [{ step: 1, value: Number.NaN }];
    expect(findNearestDatum(bad, base)).toBeNull();
    const mixed = [
      { step: 1, value: Number.NaN },
      { step: 2, value: 0.5 },
    ];
    expect(findNearestDatum(mixed, { ...base, clickX: 2, clickY: 0.5 })).toEqual({
      step: 2,
      value: 0.5,
    });
  });

  it('findNearestDatum: Date x 与 ms 点击坐标', () => {
    const t = [
      { step: new Date(1000), value: 1 },
      { step: new Date(3000), value: 2 },
    ];
    const hit = findNearestDatum(t, {
      xField: 'step',
      yField: 'value',
      clickX: 2900,
      clickY: 2,
      xMin: 1000,
      xMax: 3000,
      yMin: 1,
      yMax: 2,
    });
    expect(hit && +hit.step).toBe(3000);
  });

  it('findNearestDatum: 像素阈值内命中,超阈值返回 null', () => {
    const rows = [
      { step: 10, value: 1 },
      { step: 20, value: 100 },
    ];
    const base = {
      xField: 'step',
      yField: 'value',
      xMin: 0,
      xMax: 40,
      yMin: 0,
      yMax: 100,
      plotW: 400, // xSpan 40 → 10px/step
      plotH: 100, // ySpan 100 → 1px/单位
      maxPixelDist: 48,
    };
    // 点 (18, 90):距 (20,100) 像素 = √(20²+10²)≈22 < 48 → 命中
    expect(
      findNearestDatum(rows, { ...base, clickX: 18, clickY: 90 })
    ).toEqual({ step: 20, value: 100 });
    // 点 (0, 0):距最近点 (10,1) = √(100²+100²)≈141 > 48 → null
    expect(findNearestDatum(rows, { ...base, clickX: 0, clickY: 0 })).toBeNull();
  });
});

describe('过滤状态持久化 (localStorage)', () => {
  beforeEach(() => localStorage.clear());

  it('save → load roundtrip（模式/窗口/排除区段/排除点）', () => {
    saveFilterState('run:1:widget:w1', {
      brushMode: 'exclude',
      xWindow: [10, 50],
      excludeRanges: [[0, 5], [90, 100]],
      excludePoints: ['a 20', 'b 30'],
    });
    expect(loadFilterState('run:1:widget:w1')).toEqual({
      brushMode: 'exclude',
      xWindow: [10, 50],
      excludeRanges: [[0, 5], [90, 100]],
      excludePoints: ['a 20', 'b 30'],
    });
  });

  it('key 间互不干扰；未知 key 返回 null', () => {
    saveFilterState('k1', { brushMode: 'select', xWindow: [1, 2] });
    expect(loadFilterState('k2')).toBeNull();
    expect(loadFilterState('k1')?.xWindow).toEqual([1, 2]);
  });

  it('损坏 JSON / 非对象内容返回 null', () => {
    localStorage.setItem('trailer-line-filter-bad', '{not json');
    expect(loadFilterState('bad')).toBeNull();
    localStorage.setItem('trailer-line-filter-bad', '"a string"');
    expect(loadFilterState('bad')).toBeNull();
  });

  it('非法字段被丢弃、合法字段保留（容错恢复）', () => {
    localStorage.setItem(
      'trailer-line-filter-mix',
      JSON.stringify({
        brushMode: 'bogus',
        xWindow: [NaN, 1],
        excludeRanges: [[1, 2], ['a'], [3]],
        excludePoints: ['a 1', 42, null],
      })
    );
    expect(loadFilterState('mix')).toEqual({
      excludeRanges: [[1, 2]],
      excludePoints: ['a 1'],
    });
  });
});

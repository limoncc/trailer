import { describe, expect, it } from 'vitest';
import {
  CHART_PALETTES,
  CHART_THEME_STYLES,
  DEFAULT_THEME_STATE,
  chartPaletteFor,
  chartThemeTypeFor,
  themeStateFromJson,
  themeStateToJson,
  type ThemeState,
} from './color';

const HEX = /^#[0-9a-fA-F]{6}$/;

describe('CHART_PALETTES', () => {
  it('10 套预设 × light/dark 各 10 个合法 hex', () => {
    expect(Object.keys(CHART_PALETTES).sort()).toEqual([
      'academy', 'antv', 'deep', 'ggplot', 'light', 'okabe', 'pastel', 'vega', 'viridis', 'vivid',
    ]);
    for (const p of Object.values(CHART_PALETTES)) {
      expect(p.light).toHaveLength(10);
      expect(p.dark).toHaveLength(10);
      for (const c of [...p.light, ...p.dark]) expect(c).toMatch(HEX);
    }
  });
});

describe('chartThemeTypeFor', () => {
  it('亮色直用所选风格', () => {
    expect(chartThemeTypeFor('classic', false)).toBe('classic');
    expect(chartThemeTypeFor('light', false)).toBe('light');
    expect(chartThemeTypeFor('academy', false)).toBe('academy');
  });
  it('暗色映射:classic→classicDark、light→dark、academy 回落 classicDark(无官方暗色变体)', () => {
    expect(chartThemeTypeFor('classic', true)).toBe('classicDark');
    expect(chartThemeTypeFor('light', true)).toBe('dark');
    expect(chartThemeTypeFor('academy', true)).toBe('classicDark');
  });
  it('未知风格亮色回落 classic', () => {
    expect(chartThemeTypeFor('nope', false)).toBe('classic');
    expect(chartThemeTypeFor('nope', true)).toBe('classicDark');
  });
});

describe('chartPaletteFor', () => {
  it('default = 未激活,返回 null(图表走本地缺省兜底)', () => {
    expect(chartPaletteFor({ ...DEFAULT_THEME_STATE }, false)).toBeNull();
  });
  it('预设按暗亮取对应组', () => {
    const s: ThemeState = { ...DEFAULT_THEME_STATE, chartColor: 'antv' };
    expect(chartPaletteFor(s, false)).toEqual(CHART_PALETTES.antv.light);
    expect(chartPaletteFor(s, true)).toEqual(CHART_PALETTES.antv.dark);
  });
  it('custom 合法数据返回对应组', () => {
    const p = { light: CHART_PALETTES.antv.light, dark: CHART_PALETTES.antv.dark };
    const s: ThemeState = { ...DEFAULT_THEME_STATE, chartColor: 'custom', chartPalette: p };
    expect(chartPaletteFor(s, true)).toEqual(p.dark);
  });
  it('custom 数据非法(缺槽/坏 hex/缺失)→ null', () => {
    const base = { ...DEFAULT_THEME_STATE, chartColor: 'custom' as const };
    expect(chartPaletteFor({ ...base }, false)).toBeNull();
    expect(chartPaletteFor({ ...base, chartPalette: { light: ['#123456'], dark: [] } as never }, false)).toBeNull();
    expect(
      chartPaletteFor(
        { ...base, chartPalette: { light: [...CHART_PALETTES.antv.light], dark: ['nope', ...CHART_PALETTES.antv.dark.slice(1)] } },
        true,
      ),
    ).toBeNull();
  });
});

describe('themeStateFromJson / themeStateToJson roundtrip', () => {
  it('chartThemeStyle 白名单校验,非法回退 classic', () => {
    expect(themeStateFromJson('{"chartThemeStyle":"academy"}').chartThemeStyle).toBe('academy');
    expect(themeStateFromJson('{"chartThemeStyle":"dark"}').chartThemeStyle).toBe('classic');
    expect(themeStateFromJson('{}').chartThemeStyle).toBe('classic');
  });
  it('chartPalette 非法整体丢弃(回退 undefined = 未激活)', () => {
    const bad = JSON.stringify({
      chartColor: 'custom',
      chartPalette: { light: ['zzz', ...CHART_PALETTES.antv.light.slice(1)], dark: CHART_PALETTES.antv.dark },
    });
    expect(themeStateFromJson(bad).chartPalette).toBeUndefined();
  });
  it('完整 ThemeState roundtrip 保留 chart 维度', () => {
    const s: ThemeState = {
      ...DEFAULT_THEME_STATE,
      chartColor: 'custom',
      chartThemeStyle: 'academy',
      chartPalette: { light: [...CHART_PALETTES.antv.light], dark: [...CHART_PALETTES.antv.dark] },
    };
    const back = themeStateFromJson(themeStateToJson(s));
    expect(back.chartColor).toBe('custom');
    expect(back.chartThemeStyle).toBe('academy');
    expect(back.chartPalette?.light).toEqual(CHART_PALETTES.antv.light);
    expect(back.chartPalette?.dark).toEqual(CHART_PALETTES.antv.dark);
  });
  it('旧数据(无 chart 字段)兼容:chartColor=default 未激活', () => {
    const back = themeStateFromJson('{"baseColor":"zinc","isDark":true}');
    expect(back.chartColor).toBe('default');
    expect(back.chartThemeStyle).toBe('classic');
    expect(back.chartPalette).toBeUndefined();
  });
});

describe('CHART_THEME_STYLES', () => {
  it('三种风格与 G2 内置主题名对应', () => {
    expect(CHART_THEME_STYLES).toEqual(['classic', 'light', 'academy']);
  });
});

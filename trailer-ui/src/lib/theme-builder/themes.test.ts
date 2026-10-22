import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { THEME_SWATCHES } from './themePresets';

/**
 * 主题体系守门测试:直接解析 src/app.css 的 [data-theme] 块,断言
 *  1) 预设清单正确(cyber/nature + 12 新染色主题,旧 editorial/midnight/17 主色已移除)
 *  2) 每个新主题定义完整的语义变量集(核心 18 + sidebar 全套 + chart-1..5)
 *  3) WCAG 对比度:正文/卡片/主色按钮/侧栏前景 ≥ 4.5:1
 *  4) 背景必须带色相:明底非纯白、暗底非纯黑(本主题体系的核心承诺)
 */

const css = readFileSync(path.resolve(__dirname, '../../app.css'), 'utf-8');

/** 解析 [data-theme="xxx"] { ... } 块 → { 主题名: 变量表 } */
function parseThemeBlocks(src: string): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  const re = /\[data-theme="([a-z]+)"\]\s*\{([^}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const vars: Record<string, string> = {};
    for (const line of m[2].split(';')) {
      const kv = /^\s*--([\w-]+)\s*:\s*(.+?)\s*$/.exec(line);
      if (kv) vars[kv[1]] = kv[2];
    }
    out[m[1]] = vars;
  }
  return out;
}

/** hex(#rrggbb,#rrggbbaa 只取前 6 位) → WCAG 相对亮度 */
function luminance(hex: string): number {
  const n = parseInt(hex.slice(1, 7), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255);
  const lin = ch.map((c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}

/** 色度粗略代理:hex 通道最大差(0 = 无色相) */
function chromaProxy(hex: string): number {
  const n = parseInt(hex.slice(1, 7), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return (Math.max(...ch) - Math.min(...ch)) / 255;
}

/** 固定主题中以 data-theme 定义的(light/dark 走 :root/.dark,无块) */
const CORE_BLOCKS = ['cyber', 'nature'];
const NEW_LIGHT = ['ledger', 'ember', 'roseate', 'lilac', 'iris', 'sky', 'bay'];
const NEW_DARK = ['slate', 'dusk', 'aubergine', 'wine', 'forest'];
const ALL_NEW = [...NEW_LIGHT, ...NEW_DARK];
const REMOVED = [
  'editorial', 'midnight',
  'red', 'rose', 'orange', 'green', 'blue', 'yellow', 'violet', 'amber',
  'cyan', 'emerald', 'fuchsia', 'indigo', 'lime', 'pink', 'purple', 'teal',
];

const REQUIRED_VARS = [
  'background', 'foreground', 'card', 'card-foreground', 'popover', 'popover-foreground',
  'primary', 'primary-foreground', 'secondary', 'secondary-foreground', 'muted', 'muted-foreground',
  'accent', 'accent-foreground', 'destructive', 'border', 'input', 'ring',
  'sidebar', 'sidebar-foreground', 'sidebar-primary', 'sidebar-primary-foreground',
  'sidebar-accent', 'sidebar-accent-foreground',
  'chart-1', 'chart-2', 'chart-3', 'chart-4', 'chart-5',
];

const blocks = parseThemeBlocks(css);

describe('app.css 主题体系', () => {
  it('data-theme 块清单 = cyber/nature + 12 个新染色主题', () => {
    expect(Object.keys(blocks).sort()).toEqual([...CORE_BLOCKS, ...ALL_NEW].sort());
  });

  it('editorial/midnight/旧 17 主色主题已全部移除', () => {
    for (const name of REMOVED) {
      expect(blocks[name], name).toBeUndefined();
      expect(css.includes(`data-theme="${name}"`), name).toBe(false);
    }
  });

  it('四个固定主题中的 cyber/nature 块原样保留', () => {
    // nature 背景值被锁死,防止"固定主题不变"承诺被无意破坏
    expect(blocks.nature?.background?.toLowerCase()).toBe('#fafaf5');
    expect(blocks.nature?.primary?.toLowerCase()).toBe('#228b22');
    expect(blocks.cyber?.background).toBeDefined();
    expect(blocks.cyber?.primary).toBeDefined();
  });

  it('每个新主题定义完整的语义变量集', () => {
    for (const name of ALL_NEW) {
      const vars = blocks[name];
      expect(vars, name).toBeDefined();
      for (const k of REQUIRED_VARS) {
        expect(Object.keys(vars), `${name}.${k}`).toContain(k);
      }
    }
  });

  it('WCAG 对比度:正文/卡片/主色按钮/侧栏前景 ≥ 4.5:1', () => {
    for (const name of ALL_NEW) {
      const v = blocks[name];
      expect(contrast(v.background, v.foreground), `${name} fg/bg`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(v.card, v['card-foreground']), `${name} card fg/card`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(v.primary, v['primary-foreground']), `${name} primary`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(v.sidebar, v['sidebar-foreground']), `${name} sidebar fg/sidebar`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('明底主题非纯白、暗底主题非纯黑(背景必须带色相)', () => {
    for (const name of NEW_LIGHT) {
      const bg = blocks[name].background;
      expect(luminance(bg), `${name} bg too dark: ${bg}`).toBeGreaterThan(0.8);
      expect(chromaProxy(bg), `${name} bg achromatic: ${bg}`).toBeGreaterThan(0.015);
    }
    for (const name of NEW_DARK) {
      const bg = blocks[name].background;
      expect(luminance(bg), `${name} bg too bright: ${bg}`).toBeLessThan(0.05);
      expect(chromaProxy(bg), `${name} bg achromatic: ${bg}`).toBeGreaterThan(0.03);
    }
  });

  it('themePresets 的面板色块与 app.css 定义一致(12 新主题)', () => {
    for (const name of ALL_NEW) {
      expect(THEME_SWATCHES[name]?.bg, `${name} swatch bg`).toBe(blocks[name].background.toLowerCase());
      expect(THEME_SWATCHES[name]?.primary, `${name} swatch primary`).toBe(blocks[name].primary.toLowerCase());
    }
  });
});

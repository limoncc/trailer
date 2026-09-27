/**
 * Theme Builder 工具 —— CSS 变量读写、颜色转换、CSS 导出。
 * 项目主题基于 CSS 变量(oklch/hex),运行时改 `--xxx` 即全站生效。
 */

/** shadcn 基础灰阶色板(下拉预设),light/dark 两套核心变量 */
export const BASE_COLORS: Record<string, { light: Record<string, string>; dark: Record<string, string> }> = {
  neutral: {
    light: { background: 'oklch(1 0 0)', foreground: 'oklch(0.145 0 0)', card: 'oklch(1 0 0)', 'card-foreground': 'oklch(0.145 0 0)', popover: 'oklch(1 0 0)', 'popover-foreground': 'oklch(0.145 0 0)', primary: 'oklch(0.205 0 0)', 'primary-foreground': 'oklch(0.985 0 0)', secondary: 'oklch(0.97 0 0)', 'secondary-foreground': 'oklch(0.205 0 0)', muted: 'oklch(0.97 0 0)', 'muted-foreground': 'oklch(0.556 0 0)', accent: 'oklch(0.97 0 0)', 'accent-foreground': 'oklch(0.205 0 0)', border: 'oklch(0.922 0 0)', input: 'oklch(0.922 0 0)', ring: 'oklch(0.708 0 0)' },
    dark: { background: 'oklch(0.145 0 0)', foreground: 'oklch(0.985 0 0)', card: 'oklch(0.205 0 0)', 'card-foreground': 'oklch(0.985 0 0)', popover: 'oklch(0.269 0 0)', 'popover-foreground': 'oklch(0.985 0 0)', primary: 'oklch(0.922 0 0)', 'primary-foreground': 'oklch(0.205 0 0)', secondary: 'oklch(0.269 0 0)', 'secondary-foreground': 'oklch(0.985 0 0)', muted: 'oklch(0.269 0 0)', 'muted-foreground': 'oklch(0.708 0 0)', accent: 'oklch(0.371 0 0)', 'accent-foreground': 'oklch(0.985 0 0)', border: 'oklch(1 0 0 / 10%)', input: 'oklch(1 0 0 / 15%)', ring: 'oklch(0.556 0 0)' },
  },
  stone: {
    light: { background: 'oklch(1 0 0)', foreground: 'oklch(0.147 0.004 49.25)', card: 'oklch(1 0 0)', 'card-foreground': 'oklch(0.147 0.004 49.25)', popover: 'oklch(1 0 0)', 'popover-foreground': 'oklch(0.147 0.004 49.25)', primary: 'oklch(0.216 0.006 56.043)', 'primary-foreground': 'oklch(0.985 0.001 106.423)', secondary: 'oklch(0.97 0.001 106.424)', 'secondary-foreground': 'oklch(0.216 0.006 56.043)', muted: 'oklch(0.97 0.001 106.424)', 'muted-foreground': 'oklch(0.553 0.013 58.071)', accent: 'oklch(0.97 0.001 106.424)', 'accent-foreground': 'oklch(0.216 0.006 56.043)', border: 'oklch(0.923 0.003 48.717)', input: 'oklch(0.923 0.003 48.717)', ring: 'oklch(0.709 0.01 56.259)' },
    dark: { background: 'oklch(0.147 0.004 49.25)', foreground: 'oklch(0.985 0.001 106.423)', card: 'oklch(0.216 0.006 56.043)', 'card-foreground': 'oklch(0.985 0.001 106.423)', popover: 'oklch(0.216 0.006 56.043)', 'popover-foreground': 'oklch(0.985 0.001 106.423)', primary: 'oklch(0.923 0.003 48.717)', 'primary-foreground': 'oklch(0.216 0.006 56.043)', secondary: 'oklch(0.268 0.007 34.298)', 'secondary-foreground': 'oklch(0.985 0.001 106.423)', muted: 'oklch(0.268 0.007 34.298)', 'muted-foreground': 'oklch(0.709 0.01 56.259)', accent: 'oklch(0.268 0.007 34.298)', 'accent-foreground': 'oklch(0.985 0.001 106.423)', border: 'oklch(1 0 0 / 10%)', input: 'oklch(1 0 0 / 15%)', ring: 'oklch(0.553 0.013 58.071)' },
  },
  zinc: {
    light: { background: 'oklch(1 0 0)', foreground: 'oklch(0.141 0.005 285.823)', card: 'oklch(1 0 0)', 'card-foreground': 'oklch(0.141 0.005 285.823)', popover: 'oklch(1 0 0)', 'popover-foreground': 'oklch(0.141 0.005 285.823)', primary: 'oklch(0.21 0.006 285.885)', 'primary-foreground': 'oklch(0.985 0 0)', secondary: 'oklch(0.967 0.001 286.375)', 'secondary-foreground': 'oklch(0.21 0.006 285.885)', muted: 'oklch(0.967 0.001 286.375)', 'muted-foreground': 'oklch(0.552 0.016 285.938)', accent: 'oklch(0.967 0.001 286.375)', 'accent-foreground': 'oklch(0.21 0.006 285.885)', border: 'oklch(0.92 0.004 286.32)', input: 'oklch(0.92 0.004 286.32)', ring: 'oklch(0.705 0.015 286.067)' },
    dark: { background: 'oklch(0.141 0.005 285.823)', foreground: 'oklch(0.985 0 0)', card: 'oklch(0.21 0.006 285.885)', 'card-foreground': 'oklch(0.985 0 0)', popover: 'oklch(0.21 0.006 285.885)', 'popover-foreground': 'oklch(0.985 0 0)', primary: 'oklch(0.92 0.004 286.32)', 'primary-foreground': 'oklch(0.21 0.006 285.885)', secondary: 'oklch(0.274 0.006 286.033)', 'secondary-foreground': 'oklch(0.985 0 0)', muted: 'oklch(0.274 0.006 286.033)', 'muted-foreground': 'oklch(0.705 0.015 286.067)', accent: 'oklch(0.274 0.006 286.033)', 'accent-foreground': 'oklch(0.985 0 0)', border: 'oklch(1 0 0 / 10%)', input: 'oklch(1 0 0 / 15%)', ring: 'oklch(0.552 0.016 285.938)' },
  },
  gray: {
    light: { background: 'oklch(1 0 0)', foreground: 'oklch(0.13 0.028 261.692)', card: 'oklch(1 0 0)', 'card-foreground': 'oklch(0.13 0.028 261.692)', popover: 'oklch(1 0 0)', 'popover-foreground': 'oklch(0.13 0.028 261.692)', primary: 'oklch(0.21 0.034 264.665)', 'primary-foreground': 'oklch(0.985 0.002 247.839)', secondary: 'oklch(0.967 0.003 264.542)', 'secondary-foreground': 'oklch(0.21 0.034 264.665)', muted: 'oklch(0.967 0.003 264.542)', 'muted-foreground': 'oklch(0.551 0.027 264.364)', accent: 'oklch(0.967 0.003 264.542)', 'accent-foreground': 'oklch(0.21 0.034 264.665)', border: 'oklch(0.928 0.006 264.531)', input: 'oklch(0.928 0.006 264.531)', ring: 'oklch(0.707 0.022 261.325)' },
    dark: { background: 'oklch(0.13 0.028 261.692)', foreground: 'oklch(0.985 0.002 247.839)', card: 'oklch(0.21 0.034 264.665)', 'card-foreground': 'oklch(0.985 0.002 247.839)', popover: 'oklch(0.21 0.034 264.665)', 'popover-foreground': 'oklch(0.985 0.002 247.839)', primary: 'oklch(0.928 0.006 264.531)', 'primary-foreground': 'oklch(0.21 0.034 264.665)', secondary: 'oklch(0.278 0.033 256.848)', 'secondary-foreground': 'oklch(0.985 0.002 247.839)', muted: 'oklch(0.278 0.033 256.848)', 'muted-foreground': 'oklch(0.707 0.022 261.325)', accent: 'oklch(0.278 0.033 256.848)', 'accent-foreground': 'oklch(0.985 0.002 247.839)', border: 'oklch(1 0 0 / 10%)', input: 'oklch(1 0 0 / 15%)', ring: 'oklch(0.551 0.027 264.364)' },
  },
  slate: {
    light: { background: 'oklch(1 0 0)', foreground: 'oklch(0.129 0.042 264.695)', card: 'oklch(1 0 0)', 'card-foreground': 'oklch(0.129 0.042 264.695)', popover: 'oklch(1 0 0)', 'popover-foreground': 'oklch(0.129 0.042 264.695)', primary: 'oklch(0.208 0.042 265.755)', 'primary-foreground': 'oklch(0.984 0.003 247.858)', secondary: 'oklch(0.968 0.007 247.896)', 'secondary-foreground': 'oklch(0.208 0.042 265.755)', muted: 'oklch(0.968 0.007 247.896)', 'muted-foreground': 'oklch(0.554 0.046 257.417)', accent: 'oklch(0.968 0.007 247.896)', 'accent-foreground': 'oklch(0.208 0.042 265.755)', border: 'oklch(0.929 0.013 255.508)', input: 'oklch(0.929 0.013 255.508)', ring: 'oklch(0.704 0.04 256.788)' },
    dark: { background: 'oklch(0.129 0.042 264.695)', foreground: 'oklch(0.984 0.003 247.858)', card: 'oklch(0.208 0.042 265.755)', 'card-foreground': 'oklch(0.984 0.003 247.858)', popover: 'oklch(0.208 0.042 265.755)', 'popover-foreground': 'oklch(0.984 0.003 247.858)', primary: 'oklch(0.929 0.013 255.508)', 'primary-foreground': 'oklch(0.208 0.042 265.755)', secondary: 'oklch(0.279 0.041 260.031)', 'secondary-foreground': 'oklch(0.984 0.003 247.858)', muted: 'oklch(0.279 0.041 260.031)', 'muted-foreground': 'oklch(0.704 0.04 256.788)', accent: 'oklch(0.279 0.041 260.031)', 'accent-foreground': 'oklch(0.984 0.003 247.858)', border: 'oklch(1 0 0 / 10%)', input: 'oklch(1 0 0 / 15%)', ring: 'oklch(0.551 0.027 264.364)' },
  },
};

/** Radius 预设(rem) */
export const RADII = [
  { label: 'None', value: 0 },
  { label: 'Small', value: 0.25 },
  { label: 'Medium', value: 0.5 },
  { label: 'Default', value: 0.625 },
  { label: 'Large', value: 0.75 },
] as const;

/** 可编辑的核心语义色(不含 chart/sidebar 派生,保持简洁) */
export const THEME_VARS = [
  'background',
  'foreground',
  'card',
  'card-foreground',
  'popover',
  'popover-foreground',
  'primary',
  'primary-foreground',
  'secondary',
  'secondary-foreground',
  'muted',
  'muted-foreground',
  'accent',
  'accent-foreground',
  'destructive',
  'border',
  'input',
  'ring',
] as const;

export interface CustomTheme {
  /** CSS 变量名(无 -- 前缀) → 值 */
  vars: Record<string, string>;
  isDark: boolean;
}

const CUSTOM_KEY = 'trailer_custom_theme';

export function saveCustomTheme(t: CustomTheme) {
  localStorage.setItem(CUSTOM_KEY, JSON.stringify(t));
}
export function loadCustomTheme(): CustomTheme | null {
  try {
    const raw = localStorage.getItem(CUSTOM_KEY);
    if (!raw) return null;
    const t = JSON.parse(raw) as CustomTheme;
    if (!t || typeof t.vars !== 'object') return null;
    return t;
  } catch {
    return null;
  }
}

/** 读取当前生效的 CSS 变量值(供编辑器初始化/预设导入) */
export function readCurrentVars(): Record<string, string> {
  const cs = getComputedStyle(document.documentElement);
  const out: Record<string, string> = {};
  for (const k of THEME_VARS) out[k] = cs.getPropertyValue(`--${k}`).trim();
  out.radius = cs.getPropertyValue('--radius').trim();
  return out;
}

/** 把自定义主题应用到 <html>(data-theme="custom" + 内联 CSS 变量 + dark class) */
export function applyCustomTheme(t: CustomTheme) {
  const el = document.documentElement;
  for (const [k, v] of Object.entries(t.vars)) {
    if (v) el.style.setProperty(`--${k}`, v);
  }
  el.setAttribute('data-theme', 'custom');
  el.classList.toggle('dark', t.isDark);
}

/** 把任意 CSS 颜色(oklch/hex/rgb)转成 #rrggbb 给 color picker;失败回退黑色 */
export function cssColorToHex(color: string): string {
  if (!color) return '#000000';
  try {
    const ctx = document.createElement('canvas').getContext('2d');
    if (!ctx) return '#000000';
    ctx.fillStyle = color;
    const norm = ctx.fillStyle; // 浏览器规范化(可能返回 #hex 或 rgb())
    const m = /^#([0-9a-f]{6})$/i.exec(norm);
    if (m) return `#${m[1]}`;
    const rgb = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/i.exec(norm);
    if (rgb) {
      return `#${[rgb[1], rgb[2], rgb[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('')}`;
    }
    return '#000000';
  } catch {
    return '#000000';
  }
}

/** 生成可复制的 CSS 片段(导出/分享) */
export function generateCss(t: CustomTheme): string {
  const selector = t.isDark ? '.dark' : ':root';
  const lines = [`${selector} {`];
  for (const [k, v] of Object.entries(t.vars)) {
    lines.push(`  --${k}: ${v};`);
  }
  lines.push('}');
  return lines.join('\n');
}

/* ===== preview-02 风格主题状态 ===== */

/** 未激活时 --chart-1..5 的兜底显示值(oklch,维持 shadcn 默认);激活后由 CHART_PALETTES hex 接管 */
export const CHART_COLORS: Record<string, { light: Record<string, string>; dark: Record<string, string> }> = {
  default: {
    light: {
      'chart-1': 'oklch(0.646 0.222 41.116)',
      'chart-2': 'oklch(0.6 0.118 184.704)',
      'chart-3': 'oklch(0.398 0.07 227.392)',
      'chart-4': 'oklch(0.828 0.189 84.429)',
      'chart-5': 'oklch(0.769 0.188 70.08)',
    },
    dark: {
      'chart-1': 'oklch(0.488 0.243 264.376)',
      'chart-2': 'oklch(0.696 0.17 162.48)',
      'chart-3': 'oklch(0.769 0.188 70.08)',
      'chart-4': 'oklch(0.627 0.265 303.9)',
      'chart-5': 'oklch(0.645 0.246 16.439)',
    },
  },
};

/** G2 内置主题的实采色板(G2 5.4.8 esm/theme/*.js):
 *  antv = classic/classicDark 的 palette;light/dark = light/dark 主题 tokens;
 *  academy = academy 主题(Tableau10),dark 组为手工提亮变体(官方无暗色变体)。
 *  vivid/pastel 沿用原 Chart Color 预设(hex 化并扩到 10 色);deep 取 d3 dark2。 */
export const CHART_PALETTES: Record<string, { light: string[]; dark: string[] }> = {
  antv: {
    light: ['#5B8FF9', '#5AD8A6', '#5D7092', '#F6BD16', '#6F5EF9', '#6DC8EC', '#945FB9', '#FF9845', '#1E9493', '#FF99C3'],
    dark: ['#6C9EF2', '#79DDB4', '#7D89A5', '#FFCC4D', '#8B7CFA', '#8AD3F0', '#AB7FD1', '#FFAD6B', '#3BAEA7', '#FFB3D4'],
  },
  light: {
    light: ['#1783FF', '#00C9C9', '#F0884D', '#D580FF', '#7863FF', '#60C42D', '#BD8F24', '#FF80CA', '#2491B3', '#17C76F'],
    dark: ['#1783FF', '#00C9C9', '#F0884D', '#D580FF', '#7863FF', '#60C42D', '#BD8F24', '#FF80CA', '#2491B3', '#17C76F'],
  },
  academy: {
    light: ['#4e79a7', '#f28e2c', '#e15759', '#76b7b2', '#59a14f', '#edc949', '#af7aa1', '#ff9da7', '#9c755f', '#bab0ab'],
    dark: ['#6b95c9', '#f5a650', '#e8707a', '#8cc9c4', '#6fb566', '#f0d966', '#c193b8', '#ffb3bd', '#b28f78', '#c8c2bd'],
  },
  vivid: {
    light: ['#7C6AF9', '#16B8A0', '#F5B914', '#F0537E', '#4D8DF7', '#F97316', '#06B6D4', '#84CC16', '#EC4899', '#8B5CF6'],
    dark: ['#9B8CFA', '#3BD0BB', '#FFCB3D', '#F76E93', '#6FA6F9', '#FB8C3C', '#2DD4E8', '#A3E635', '#F472B6', '#A78BFA'],
  },
  pastel: {
    light: ['#9BA8E8', '#97C9A8', '#E3D08F', '#D6A6CE', '#D9A18F', '#A8C6E8', '#C9B6E3', '#E8B6B6', '#A6D6CE', '#D6C9A8'],
    dark: ['#8291D1', '#7FB590', '#C9B67A', '#BE8AB4', '#C28A79', '#8FB0D1', '#AB98C9', '#C99B9B', '#8BBDB4', '#B9AC8F'],
  },
  deep: {
    light: ['#1b9e77', '#d95f02', '#7570b3', '#e7298a', '#66a61e', '#e6ab02', '#a6761d', '#666666', '#18837e', '#ad5343'],
    dark: ['#2fc197', '#f57a1e', '#9691d6', '#f051a8', '#7dc736', '#f5c22b', '#c98f36', '#a0a0a0', '#23a6a0', '#d16a52'],
  },
};

/** G2 图表风格(内置主题名);暗色 UI 下由 chartThemeTypeFor 映射到对应暗色变体 */
export const CHART_THEME_STYLES = ['classic', 'light', 'academy'] as const;

const HEX_RE = /^#[0-9a-fA-F]{6}$/;
function isHex10(a: unknown): a is string[] {
  return Array.isArray(a) && a.length === 10 && a.every((c) => typeof c === 'string' && HEX_RE.test(c));
}

/** 图表风格 → 当前暗亮下应使用的 G2 theme 名:
 *  academy 无官方暗色变体,暗色回落 classicDark。 */
export function chartThemeTypeFor(style: string, isDark: boolean): string {
  if (!isDark) return (CHART_THEME_STYLES as readonly string[]).includes(style) ? style : 'classic';
  if (style === 'light') return 'dark';
  return 'classicDark';
}

/** 当前激活的图表色板(具体 hex 数组,供 G2 scale/theme 注入与衍生气使用)。
 *  返回 null = 未激活(chartColor 为 default 或 custom 数据非法)→ 调用方走本地缺省兜底。 */
export function chartPaletteFor(s: ThemeState, isDark: boolean): string[] | null {
  if (s.chartColor === 'default') return null;
  if (s.chartColor === 'custom') {
    const arr = isDark ? s.chartPalette?.dark : s.chartPalette?.light;
    return isHex10(arr) ? arr : null;
  }
  const p = CHART_PALETTES[s.chartColor];
  return p ? (isDark ? p.dark : p.light) : null;
}

/** 字体选项:Inter 用真实字体,其余系统字体栈 */
export const FONTS = [
  { id: 'inter', label: 'Inter', family: "'Inter Variable', ui-sans-serif, system-ui, sans-serif" },
  { id: 'system', label: 'System', family: 'ui-sans-serif, system-ui, sans-serif' },
  { id: 'serif', label: 'Serif', family: 'ui-serif, Georgia, Cambria, serif' },
  { id: 'mono', label: 'Mono', family: 'ui-monospace, SFMono-Regular, Menlo, monospace' },
] as const;

export const MENU_STYLES = ['default', 'solid'] as const;
export const MENU_ACCENTS = ['subtle', 'bold'] as const;

export interface ThemeState {
  /** 基础色板 id(见 BASE_COLORS) */
  baseColor: string;
  /** 主题预设 id(light/dark/cyber/nature/editorial/midnight) */
  theme: string;
  /** 图表色板 id:'default'=未激活(图表走各自本地缺省);其余见 CHART_PALETTES;'custom'=chartPalette */
  chartColor: string;
  /** G2 图表风格 id(见 CHART_THEME_STYLES);决定底色/轴/网格等非颜色观感 */
  chartThemeStyle: string;
  /** Custom 模式的色板(chartColor='custom' 时生效);light/dark 两组各 10 个 #rrggbb */
  chartPalette?: { light: string[]; dark: string[] };
  /** 正文字体 id(见 FONTS) */
  font: string;
  /** 标题字体 id(见 FONTS) */
  headingFont: string;
  menu: (typeof MENU_STYLES)[number];
  menuAccent: (typeof MENU_ACCENTS)[number];
  isDark: boolean;
  vars: Record<string, string>;
}

export const DEFAULT_THEME_STATE: ThemeState = {
  baseColor: 'neutral',
  theme: 'light',
  chartColor: 'default',
  chartThemeStyle: 'classic',
  font: 'inter',
  headingFont: 'inter',
  menu: 'default',
  menuAccent: 'subtle',
  isDark: false,
  vars: {},
};

/** 增量覆盖:chart 色板 + Menu/Menu Accent 的 sidebar 变量(核心色由 BASE_COLORS 应用时写入 vars) */
export function resolveOverrides(state: ThemeState): Record<string, string> {
  const vars: Record<string, string> = {};
  // 激活的图表色板 → --chart-1..5 写 hex 前 5 色;未激活保持 CHART_COLORS.default(oklch 现状)
  const pal = chartPaletteFor(state, state.isDark);
  if (pal) {
    for (let i = 0; i < 5; i++) vars[`chart-${i + 1}`] = pal[i];
  } else if (state.chartColor === 'default') {
    const chart = CHART_COLORS.default;
    const s = state.isDark ? chart.dark : chart.light;
    for (const k of Object.keys(s)) vars[k] = s[k];
  }
  if (state.menu === 'solid') vars.sidebar = 'var(--sidebar-accent)';
  if (state.menuAccent === 'bold') {
    vars['sidebar-accent'] = 'var(--primary)';
    vars['sidebar-accent-foreground'] = 'var(--primary-foreground)';
  }
  return vars;
}

/** 把字体写到 <html> 内联(覆盖 :root 默认),仅当传入字体 id 有效时 */
export function applyFonts(font: string, headingFont: string) {
  const el = document.documentElement;
  const body = FONTS.find((f) => f.id === font) ?? FONTS[0];
  const head = FONTS.find((f) => f.id === headingFont) ?? body;
  el.style.setProperty('--font-sans', body.family);
  el.style.setProperty('--font-heading', head.family);
}

/** 应用 ThemeState 全量到 <html>:data-theme 预设 + 内联变量 + chart/sidebar 覆盖 + 字体。
 *  应用完成通知订阅者(chartTheme 枢纽刷新激活快照并触发图表重建)。 */
const OVERRIDE_KEYS = [
  ...THEME_VARS,
  'radius',
  'chart-1',
  'chart-2',
  'chart-3',
  'chart-4',
  'chart-5',
  'sidebar',
  'sidebar-accent',
  'sidebar-accent-foreground',
  'font-sans',
  'font-heading',
];

const appliedListeners = new Set<() => void>();

/** 最近一次 applyThemeState 的状态(内存快照);Theme Builder 预览只 apply 不落盘,
 *  chartTheme 枢纽经此读取编辑中的激活态,不能只看 localStorage。 */
let latestState: ThemeState | null = null;

export function getCurrentThemeState(): ThemeState | null {
  return latestState;
}

/** 订阅 ThemeState 应用事件(ThemeState 保存/预览/切换时触发)。返回退订函数。
 *  chartTheme 枢纽经此补「只换色板不切暗色也重建」的通知缺口。 */
export function onThemeStateApplied(cb: () => void): () => void {
  appliedListeners.add(cb);
  return () => appliedListeners.delete(cb);
}

export function applyThemeState(s: ThemeState) {
  latestState = s;
  const el = document.documentElement;
  el.setAttribute('data-theme', s.theme);
  el.classList.toggle('dark', s.isDark);
  for (const k of OVERRIDE_KEYS) el.style.removeProperty(`--${k}`);
  const merged = { ...s.vars, ...resolveOverrides(s) };
  for (const [k, v] of Object.entries(merged)) {
    if (v) el.style.setProperty(`--${k}`, v);
  }
  applyFonts(s.font, s.headingFont);
  appliedListeners.forEach((fn) => fn());
}

/** 清除所有主题内联覆盖(供预设切换前让 data-theme 预设值生效) */
export function clearThemeInlineOverrides() {
  const el = document.documentElement;
  for (const k of OVERRIDE_KEYS) el.style.removeProperty(`--${k}`);
}

const STATE_KEY = 'trailer_theme_state';

/** 持久化完整主题状态(localStorage) */
export function saveThemeState(s: ThemeState) {
  localStorage.setItem(STATE_KEY, JSON.stringify(s));
}
export function loadThemeState(): ThemeState | null {
  try {
    const raw = localStorage.getItem(STATE_KEY);
    if (!raw) return null;
    return themeStateFromJson(raw);
  } catch {
    return null;
  }
}

/** 把 ThemeState 序列化为后端可存的 JSON 字符串(带 name 兼容 +layout) */
export function themeStateToJson(s: ThemeState): string {
  return JSON.stringify({ ...s, name: 'custom' });
}

/** 从 JSON 反序列化 ThemeState,缺失字段回退默认(兼容旧数据) */
export function themeStateFromJson(raw: string | null | undefined): ThemeState {
  const d = DEFAULT_THEME_STATE;
  try {
    const t = JSON.parse(raw || '{}');
    if (!t || typeof t !== 'object') return { ...d };
    // chartPalette 白名单校验:两组各 10 个合法 hex,非法整体丢弃(回退未激活)
    const chartPalette =
      t.chartPalette &&
      typeof t.chartPalette === 'object' &&
      isHex10(t.chartPalette.light) &&
      isHex10(t.chartPalette.dark)
        ? { light: [...t.chartPalette.light], dark: [...t.chartPalette.dark] }
        : undefined;
    return {
      baseColor: typeof t.baseColor === 'string' ? t.baseColor : d.baseColor,
      theme: typeof t.theme === 'string' ? t.theme : d.theme,
      chartColor: typeof t.chartColor === 'string' ? t.chartColor : d.chartColor,
      chartThemeStyle: (CHART_THEME_STYLES as readonly string[]).includes(t.chartThemeStyle)
        ? t.chartThemeStyle
        : d.chartThemeStyle,
      chartPalette,
      font: typeof t.font === 'string' ? t.font : d.font,
      headingFont: typeof t.headingFont === 'string' ? t.headingFont : d.headingFont,
      menu: MENU_STYLES.includes(t.menu) ? t.menu : d.menu,
      menuAccent: MENU_ACCENTS.includes(t.menuAccent) ? t.menuAccent : d.menuAccent,
      isDark: typeof t.isDark === 'boolean' ? t.isDark : d.isDark,
      vars: t.vars && typeof t.vars === 'object' ? (t.vars as Record<string, string>) : d.vars,
    };
  } catch {
    return { ...d };
  }
}

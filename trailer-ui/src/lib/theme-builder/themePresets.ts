/**
 * 预设主题清单与旧名迁移 —— 单一来源(供 +layout 面板与 themes.test 守门测试共用)。
 * 预设主题的 CSS 变量定义在 src/app.css 的 [data-theme="xxx"] 块;
 * light/dark 走 :root/.dark,无 data-theme 块。
 */

/** 固定四主题(产品承诺:Light/Dark/Cyber/Nature 不变) */
export const CORE_THEMES = ['light', 'dark', 'cyber', 'nature'] as const;
/** 染色明底主题(Nature 同类:淡染色底 + 同色相深色字) */
export const NEW_LIGHT_THEMES = ['ledger', 'ember', 'roseate', 'lilac', 'iris', 'sky', 'bay'] as const;
/** 染色暗底主题(带色相的深底,绝非纯黑) */
export const NEW_DARK_THEMES = ['slate', 'dusk', 'aubergine', 'wine', 'forest'] as const;

export const KNOWN_THEMES: ReadonlySet<string> = new Set<string>([
  ...CORE_THEMES, ...NEW_LIGHT_THEMES, ...NEW_DARK_THEMES,
]);

/** 暗底主题名单 —— <html> dark class 判定的唯一来源 */
export const DARK_THEMES: ReadonlySet<string> = new Set<string>([
  'dark', 'cyber', ...NEW_DARK_THEMES,
]);

export function isDarkTheme(name: string): boolean {
  return DARK_THEMES.has(name);
}

/** 已废弃主题名 → 最接近的新主题(色相就近);editorial/midnight + 旧 17 主色主题 */
export const LEGACY_THEME_MAP: Record<string, string> = {
  editorial: 'sky',
  midnight: 'dusk',
  red: 'wine',
  rose: 'roseate',
  pink: 'roseate',
  orange: 'ember',
  amber: 'ledger',
  yellow: 'ledger',
  lime: 'forest',
  green: 'forest',
  emerald: 'bay',
  teal: 'bay',
  cyan: 'sky',
  blue: 'iris',
  indigo: 'iris',
  violet: 'aubergine',
  purple: 'aubergine',
  fuchsia: 'lilac',
};

/** 把 localStorage/后端存的旧主题名迁移到现行预设名。
 *  'custom' 原样保留;未知名回退 light(保证任何旧数据都不落回纯白/纯黑之外的未定义态)。 */
export function migrateThemeName(name: string | null | undefined): string {
  const n = name ?? 'light';
  if (n === 'custom' || KNOWN_THEMES.has(n)) return n;
  return LEGACY_THEME_MAP[n] ?? 'light';
}

/** 主题面板色块(bg + primary);12 个新主题的值由 themes.test 与 app.css 比对锁死 */
export const THEME_SWATCHES: Record<string, { bg: string; primary: string }> = {
  light: { bg: '#ffffff', primary: '#2b2b2b' },
  dark: { bg: '#232323', primary: '#e8e8e8' },
  cyber: { bg: '#121820', primary: '#22c1e8' },
  nature: { bg: '#fafaf5', primary: '#228b22' },
  ledger: { bg: '#faf5e8', primary: '#805600' },
  ember: { bg: '#fff2ed', primary: '#9c4621' },
  roseate: { bg: '#fef2f3', primary: '#9f3d4f' },
  lilac: { bg: '#faf3fb', primary: '#8e4f98' },
  iris: { bg: '#f0f6ff', primary: '#3261af' },
  sky: { bg: '#edf7fd', primary: '#006c98' },
  bay: { bg: '#ecf8f9', primary: '#006c72' },
  slate: { bg: '#0b1116', primary: '#8cb6db' },
  dusk: { bg: '#0a0f1d', primary: '#87abff' },
  aubergine: { bg: '#130c1a', primary: '#c495f4' },
  wine: { bg: '#190b11', primary: '#e380a9' },
  forest: { bg: '#04130e', primary: '#3fc8a1' },
};

/** 面板标题格式化(Ledger / Roseate …) */
export function themeLabel(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

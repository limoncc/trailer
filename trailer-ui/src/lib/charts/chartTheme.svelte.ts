// 全局 G2 图表暗色主题适配。
// 应用的暗色 = <html> 上的 .dark 类(mode-watcher / theme-builder 统一走这里)。
// MutationObserver 同步到模块级响应式 state——各图表组件的创建/重建 $effect
// 读取 isChartDark() 即注册依赖,主题切换时自动销毁重建图表。
//
// 图表配色激活态:Theme Builder 的 Chart Color/Style 选择保存在 ThemeState
// (localStorage)。本模块维护「当前激活快照」(色板组 + G2 theme 类型名):
// - ThemeState 应用(color.ts onThemeStateApplied)→ 刷新快照 + 通知图表重建
//   (补「只换色板不切暗色也重建」的通知缺口);
// - 未激活(chartColor='default')时 palette=null,g2Theme()/themeOpts() 保持
//   历史行为(亮色无 theme、暗色 classicDark),各图表走本地缺省色板零变化。

import {
  chartPaletteFor,
  chartThemeTypeFor,
  getCurrentThemeState,
  loadThemeState,
  onThemeStateApplied,
} from '$lib/theme-builder/color';

const dark = $state({ value: false });
// 激活快照:palette=null 表示未激活;type = 当前暗亮下应使用的 G2 theme 名
const chart = $state({ palette: null as string[] | null, type: 'classic' });
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((fn) => fn());
}

function refresh() {
  // 内存快照优先(Theme Builder 预览只 apply 不落盘);localStorage 供首帧兜底
  const s = getCurrentThemeState() ?? (typeof localStorage !== 'undefined' ? loadThemeState() : null);
  const style = s?.chartThemeStyle ?? 'classic';
  chart.type = chartThemeTypeFor(style, dark.value);
  chart.palette = s ? chartPaletteFor(s, dark.value) : null;
}

if (typeof document !== 'undefined') {
  const sync = () => {
    dark.value = document.documentElement.classList.contains('dark');
    // 暗亮切换影响色板组(light/dark)与风格映射(academy→classicDark 等)
    refresh();
    notify();
  };
  sync();
  new MutationObserver(sync).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['class'],
  });
  // Theme Builder 应用/保存/预览 ThemeState 时刷新(不切暗色也能换色板)
  onThemeStateApplied(() => {
    refresh();
    notify();
  });
}

export function isChartDark(): boolean {
  return dark.value;
}

/** 当前激活的图表色板;null = 未激活(调用方走本地缺省兜底,保持历史配色)。 */
export function chartPalette(): string[] | null {
  return chart.palette;
}

/** 暗色用 classicDark(G2 自动把网格/轴文字等组件切浅色),view 背景透明以适配
 *  自定义主题的卡片底色;浅色保持 G2 默认(历史上无 theme,避免回归)。
 *  图表主题激活后:注入风格映射后的 theme 名 + 色板(category10)与 defaultColor;
 *  未激活时维持原行为 —— 暗色 {type:'classicDark',view},亮色 undefined。 */
export function g2Theme(): Record<string, unknown> | undefined {
  if (!dark.value && !chart.palette) return undefined;
  const t: Record<string, unknown> = { type: chart.type, view: { viewFill: 'transparent' } };
  if (chart.palette) {
    // G2 theme 对象的色板字段:源码 tokens 为 category10,文档示例为 colors10;
    // 两处都写,运行时取生效者(结构多余键被忽略)
    t.category10 = chart.palette;
    t.colors10 = chart.palette;
    t.defaultColor = chart.palette[0];
  }
  return t;
}

/** 展开进 `new Chart({...})` / `chart.options({...})` 的主题片段 */
export function themeOpts(): Record<string, unknown> {
  const t = g2Theme();
  return t ? { theme: t } : {};
}

/** 轴刻度/网格数量随容器尺寸自适应(G2 默认固定 tick 数,窄容器下网格过密)。
 *  size: 容器像素宽/高;minPx: 每个 tick 至少占用的像素;结果夹在 [2, max]。 */
export function adaptiveTicks(size: number, minPx: number, max: number): number {
  const n = Number.isFinite(size) && size > 0 ? Math.floor(size / minPx) : 0;
  return Math.min(max, Math.max(2, n));
}

/** 轴标签/浮点值自适应格式化:整数原样,小数收敛到 4 位有效数字,
 *  去掉浮点长尾(hist bucket 中点 -0.06000000000000001 一类)——轴标签短才可读。 */
export function formatAxisTick(v: number): string {
  if (!Number.isFinite(v)) return String(v);
  if (Number.isInteger(v)) return String(v);
  return String(parseFloat(v.toPrecision(4)));
}

/** 订阅主题切换(命令式图表在 onMount 订阅、清理函数退订,
 *  不用 $effect 跟踪——图表创建属于外部事件驱动的命令式副作用)。返回退订函数。 */
export function onChartThemeChange(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

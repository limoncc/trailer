// 全局 G2 图表暗色主题适配。
// 应用的暗色 = <html> 上的 .dark 类(mode-watcher / theme-builder 统一走这里)。
// MutationObserver 同步到模块级响应式 state——各图表组件的创建/重建 $effect
// 读取 isChartDark() 即注册依赖,主题切换时自动销毁重建图表。

const dark = $state({ value: false });
const listeners = new Set<() => void>();

if (typeof document !== 'undefined') {
  const sync = () => {
    dark.value = document.documentElement.classList.contains('dark');
    listeners.forEach((fn) => fn());
  };
  sync();
  new MutationObserver(sync).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['class'],
  });
}

export function isChartDark(): boolean {
  return dark.value;
}

/** 暗色用 classicDark(G2 自动把网格/轴文字等组件切浅色),view 背景透明以适配
 *  自定义主题的卡片底色;浅色保持 G2 默认(历史上无 theme,避免回归)。 */
export function g2Theme() {
  if (!dark.value) return undefined;
  return { type: 'classicDark', view: { viewFill: 'transparent' } };
}

/** 展开进 `new Chart({...})` / `chart.options({...})` 的主题片段 */
export function themeOpts(): Record<string, unknown> {
  const t = g2Theme();
  return t ? { theme: t } : {};
}

/** 订阅主题切换(命令式图表在 onMount 订阅、清理函数退订,
 *  不用 $effect 跟踪——图表创建属于外部事件驱动的命令式副作用)。返回退订函数。 */
export function onChartThemeChange(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

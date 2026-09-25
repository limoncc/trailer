import type { DashWidget } from './dashboard';

// ─── Widget 类型注册表 ───
// 驱动「添加图表」弹窗的类型 tab 与解析分发。新增类型:
// 1) dashboard.ts 扩展 DashWidget + parseWidget + defaultSize + defaultWidgetTitle
// 2) 此处追加一条元信息(hosts 决定在哪个宿主出现:boards 单 run 看板 / explore 对比看板)
// 3) WidgetContent.svelte 加渲染分支
// 4) WidgetPickerDialog.svelte 加选择分支
export type WidgetHost = 'boards' | 'explore';

export interface WidgetTypeMeta {
  type: DashWidget['type'];
  label: string;
  /** 选内容时列表为空的提示 */
  emptyHint: string;
  /** 出现宿主;缺省仅 boards(单 run 看板),explore 卡只在 Explore 出现 */
  hosts?: WidgetHost[];
}

export const WIDGET_TYPES: WidgetTypeMeta[] = [
  { type: 'info', label: 'Info', emptyHint: 'Select metrics, hyperparameters and cost to display' },
  { type: 'line', label: 'Metrics', emptyHint: 'Run has no metrics yet', hosts: ['boards', 'explore'] },
  { type: 'hist', label: 'Histograms', emptyHint: 'Run has no histograms yet' },
  { type: 'pca', label: 'PCA', emptyHint: 'Run has no PCA data yet' },
  { type: 'landscape', label: 'Landscape', emptyHint: 'Run has no landscape data yet' },
  { type: 'figure', label: 'Figures', emptyHint: 'Run has no figures yet' },
  { type: 'text', label: 'Texts', emptyHint: 'Run has no text entries yet' },
  { type: 'table', label: 'Tables', emptyHint: 'Run has no tables yet' },
  { type: 'media', label: 'Media', emptyHint: 'Run has no media yet' },
  // ── Explore 对比看板(多 run 语义,依赖 config+summary+metrics 数据面) ──
  { type: 'scatter', label: 'Scatter', emptyHint: 'Select at least one run', hosts: ['explore'] },
  { type: 'scatter-pair', label: 'Pair', emptyHint: 'Run has no metrics yet', hosts: ['explore'] },
  { type: 'parallel', label: 'Parallel', emptyHint: 'Select at least one run', hosts: ['explore'] },
  { type: 'diff', label: 'Diff', emptyHint: 'Select 2+ runs to diff', hosts: ['explore'] },
  { type: 'summary', label: 'Summary', emptyHint: 'Runs have no summary yet', hosts: ['explore'] },
];

/** 某宿主可见的类型列表(Boards 弹窗 / Explore 编辑器) */
export function widgetTypesFor(host: WidgetHost): WidgetTypeMeta[] {
  return WIDGET_TYPES.filter((t) => (t.hosts ?? ['boards']).includes(host));
}

/** 各类型 tab 的数据可用性:没数据的 tab 不渲染(全排开必然换行)。
 *  info 算「有数据」只要 metrics 或 config 任一存在;
 *  Explore 类按 runs/summaryKeys 计数(diff 需 2+ run、summary 需有 summary 指标)。 */
export function widgetTypeAvailability(counts: {
  metrics: number;
  config: number;
  hists: number;
  pca: number;
  landscape: number;
  figures: number;
  texts: number;
  tables: number;
  media: number;
  /** Explore:可见(未隐藏)run 数 */
  runs?: number;
  /** Explore:summary 指标数(summary key 并集) */
  summaryKeys?: number;
}): Record<WidgetTypeMeta['type'], boolean> {
  const runs = counts.runs ?? 0;
  const summaryKeys = counts.summaryKeys ?? 0;
  return {
    info: counts.metrics > 0 || counts.config > 0,
    line: counts.metrics > 0,
    hist: counts.hists > 0,
    pca: counts.pca > 0,
    landscape: counts.landscape > 0,
    figure: counts.figures > 0,
    text: counts.texts > 0,
    table: counts.tables > 0,
    media: counts.media > 0,
    scatter: runs > 0,
    'scatter-pair': summaryKeys >= 2,
    parallel: runs > 0,
    diff: runs >= 2,
    summary: summaryKeys > 0,
  };
}

import type { DashWidget } from './dashboard';

// ─── Widget 类型注册表 ───
// 驱动「添加图表」弹窗的类型 tab 与解析分发。新增 log 类型:
// 1) dashboard.ts 扩展 DashWidget + parseWidget + defaultSize
// 2) 此处追加一条元信息
// 3) WidgetContent.svelte 加渲染分支
// 4) WidgetPickerDialog.svelte 加选择分支
export interface WidgetTypeMeta {
  type: DashWidget['type'];
  label: string;
  /** 选内容时列表为空的提示 */
  emptyHint: string;
}

export const WIDGET_TYPES: WidgetTypeMeta[] = [
  { type: 'info', label: 'Info', emptyHint: 'Select metrics, hyperparameters and cost to display' },
  { type: 'line', label: 'Metrics', emptyHint: 'Run has no metrics yet' },
  { type: 'hist', label: 'Histograms', emptyHint: 'Run has no histograms yet' },
  { type: 'pca', label: 'PCA', emptyHint: 'Run has no PCA data yet' },
  { type: 'landscape', label: 'Landscape', emptyHint: 'Run has no landscape data yet' },
  { type: 'figure', label: 'Figures', emptyHint: 'Run has no figures yet' },
  { type: 'text', label: 'Texts', emptyHint: 'Run has no text entries yet' },
  { type: 'table', label: 'Tables', emptyHint: 'Run has no tables yet' },
  { type: 'media', label: 'Media', emptyHint: 'Run has no media yet' },
];

/** 各类型 tab 的数据可用性:没数据的 tab 不渲染(9 个 tab 全排开必然换行)。
 *  info 算「有数据」只要 metrics 或 config 任一存在。 */
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
}): Record<WidgetTypeMeta['type'], boolean> {
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
  };
}

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
  { type: 'line', label: 'Metrics', emptyHint: 'Run has no metrics yet' },
  { type: 'hist', label: 'Histograms', emptyHint: 'Run has no histograms yet' },
  { type: 'figure', label: 'Figures', emptyHint: 'Run has no figures yet' },
  { type: 'text', label: 'Texts', emptyHint: 'Run has no text entries yet' },
  { type: 'table', label: 'Tables', emptyHint: 'Run has no tables yet' },
  { type: 'media', label: 'Media', emptyHint: 'Run has no media yet' },
];

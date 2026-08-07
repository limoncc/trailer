/** PCA 3D 模块共享类型（与 docs/pca-viewer 数据格式对齐） */

export interface PcaCluster {
  id: number;
  label: string;
  color: string;
  count: number;
}

export interface PcaPoint {
  x: number;
  y: number;
  z: number;
  cluster: string;
}

export interface PcaMeta {
  title?: string;
  n_samples?: number;
  n_components?: number;
  explained_variance?: number[];
  axis_labels?: string[];
  clusters?: PcaCluster[];
}

export interface PcaData {
  meta: PcaMeta;
  points: PcaPoint[];
}

/** figures 表里 kind='pca' 的记录 */
export interface PcaFigureRow {
  run_id: string;
  step: number;
  name: string;
  kind: 'pca';
  body: string;
}

/** 按 name 分组的 PCA 卡片 */
export interface PcaGroup {
  name: string;
  rows: PcaFigureRow[]; // 按 step 升序
}

export interface PcaHoverInfo {
  cluster: string;
  x: number;
  y: number;
  z: number;
  mx: number;
  my: number;
}

/** PCA3DViewer 主题色（light/dark 两套） */
export const PCA_THEME = {
  light: { bg: 0xffffff, grid: 0xc9d4e3, axis: 0x334155 },
  dark: { bg: 0x0f172a, grid: 0x334155, axis: 0x94a3b8 },
} as const;

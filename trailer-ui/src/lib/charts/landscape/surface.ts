/**
 * 曲面网格几何构建 —— 纯函数（配套 surface.test.ts），与 Three.js 解耦。
 *
 * 顶点布局：行主序（r=β 行、c=α 列），position = (xs[c], h(z), ys[r])，
 * 颜色 = viridis(z 归一化)。索引为每格两个三角形。
 */
import { colormap, type ParsedLandscape } from './landscape';

export const SURFACE_THEME = {
  light: { bg: 0xffffff, grid: 0xc9d4e3, axis: 0x334155 },
  dark: { bg: 0x0f172a, grid: 0x334155, axis: 0x94a3b8 },
} as const;

export interface SurfaceGeometry {
  /** 顶点坐标 xyz，长度 nRows*nCols*3 */
  positions: Float32Array;
  /** 顶点 RGB(0-1)，长度 nRows*nCols*3 */
  colors: Float32Array;
  /** 三角形索引，长度 (nRows-1)*(nCols-1)*6 */
  indices: Uint32Array;
  /** 高度轴跨度（世界单位） */
  hSpan: number;
}

/**
 * 把解析后的景观网格转成带顶点色的三角面片。
 * @param hSpan 高度轴世界跨度（默认 6，与默认视角距离匹配）
 * @throws 网格为空或边长 <2
 */
export function buildSurfaceGeometry(d: ParsedLandscape, hSpan = 6): SurfaceGeometry {
  if (d.nRows < 2 || d.nCols < 2 || d.z.length < d.nRows * d.nCols) {
    throw new Error('landscape 网格无效：至少 2×2');
  }
  const { nRows, nCols } = d;
  const range = d.zmax - d.zmin;
  const positions = new Float32Array(nRows * nCols * 3);
  const colors = new Float32Array(nRows * nCols * 3);

  for (let r = 0; r < nRows; r++) {
    for (let c = 0; c < nCols; c++) {
      const i = r * nCols + c;
      const t = range > 0 ? (d.z[i] - d.zmin) / range : 0;
      positions[i * 3] = d.xs[c];
      positions[i * 3 + 1] = t * hSpan;
      positions[i * 3 + 2] = d.ys[r];
      const [cr, cg, cb] = colormap(t);
      colors[i * 3] = cr / 255;
      colors[i * 3 + 1] = cg / 255;
      colors[i * 3 + 2] = cb / 255;
    }
  }

  const indices = new Uint32Array((nRows - 1) * (nCols - 1) * 6);
  let k = 0;
  for (let r = 0; r < nRows - 1; r++) {
    for (let c = 0; c < nCols - 1; c++) {
      const a = r * nCols + c;
      const b = a + 1;
      const cc = a + nCols;
      const dd = cc + 1;
      // 两个三角形（顶点朝 +y 可见；DoubleSide 渲染时序无关紧要，但保持一致）
      indices[k++] = a; indices[k++] = cc; indices[k++] = b;
      indices[k++] = b; indices[k++] = cc; indices[k++] = dd;
    }
  }

  return { positions, colors, indices, hSpan };
}

/** 高度轴的 bbox 上限（供相机 fit / 网格包围盒计算）。 */
export function surfaceHeightBounds(g: SurfaceGeometry): { hMin: number; hMax: number } {
  return { hMin: 0, hMax: g.hSpan };
}

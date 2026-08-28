/**
 * 曲面网格几何构建 —— 纯函数（配套 surface.test.ts），与 Three.js 解耦。
 *
 * 顶点布局：行主序（r=β 行、c=α 列），position = (xs[c], h(z), ys[r])，
 * 颜色 = viridis(z 归一化)。索引为每格两个三角形。
 */
import { colormap, makeLandscapeScaler, type LandscapeScale, type ParsedLandscape } from './landscape';

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
 * @param cmapName 配色方案（默认 coolwarm）
 * @param scale 值域缩放：linear 常规 min-max；log 放大碗底细节（默认 linear）
 * @throws 网格为空或边长 <2
 */
export function buildSurfaceGeometry(
  d: ParsedLandscape,
  hSpan = 6,
  cmapName: string = 'coolwarm',
  scale: LandscapeScale = 'linear',
): SurfaceGeometry {
  if (d.nRows < 2 || d.nCols < 2 || d.z.length < d.nRows * d.nCols) {
    throw new Error('landscape 网格无效：至少 2×2');
  }
  const { nRows, nCols } = d;
  const scaler = makeLandscapeScaler(d.zmin, d.zmax, scale);
  const positions = new Float32Array(nRows * nCols * 3);
  const colors = new Float32Array(nRows * nCols * 3);

  for (let r = 0; r < nRows; r++) {
    for (let c = 0; c < nCols; c++) {
      const i = r * nCols + c;
      const t = scaler.toT(d.z[i]);
      positions[i * 3] = d.xs[c];
      positions[i * 3 + 1] = t * hSpan;
      positions[i * 3 + 2] = d.ys[r];
      const [cr, cg, cb] = colormap(t, cmapName);
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

// ===== 小球滚落（梯度下降轨迹，纯函数可测）=====

export type BallPoint = [number, number, number]; // (α, β, loss)

export interface RollOptions {
  /** 学习率（网格索引单位） */
  lr?: number;
  /** 动量 */
  momentum?: number;
  /** 最大迭代步 */
  maxSteps?: number;
  /** 动画帧上限（路径均匀降采样） */
  maxPoints?: number;
}

function bilinear(d: ParsedLandscape, u: number, v: number): number {
  const cu = Math.min(Math.max(u, 0), d.nCols - 1);
  const cv = Math.min(Math.max(v, 0), d.nRows - 1);
  const i = Math.min(Math.floor(cu), d.nCols - 2);
  const j = Math.min(Math.floor(cv), d.nRows - 2);
  const fu = cu - i;
  const fv = cv - j;
  const z00 = d.z[j * d.nCols + i];
  const z10 = d.z[j * d.nCols + i + 1];
  const z01 = d.z[(j + 1) * d.nCols + i];
  const z11 = d.z[(j + 1) * d.nCols + i + 1];
  return z00 * (1 - fu) * (1 - fv) + z10 * fu * (1 - fv) + z01 * (1 - fu) * fv + z11 * fu * fv;
}

/**
 * 从全局最高点出发的动量梯度下降轨迹（"小球滚落"动画的数据）。
 * 在连续网格索引空间做中心差分 + 动量更新，输出数据空间 (α, β, loss) 路径。
 */
export function rollBallPath(d: ParsedLandscape, opts: RollOptions = {}): BallPoint[] {
  const { lr = 0.9, momentum = 0.8, maxSteps = 600, maxPoints = 160 } = opts;
  if (d.z.length === 0) return [];

  // 起点：全局最大 cell（最陡滚落，视觉最有戏剧性）
  let start = 0;
  for (let i = 1; i < d.z.length; i++) if (d.z[i] > d.z[start]) start = i;
  let u = start % d.nCols;
  let v = Math.floor(start / d.nCols);

  let vu = 0, vv = 0;
  const raw: BallPoint[] = [[d.xs[Math.round(u)], d.ys[Math.round(v)], bilinear(d, u, v)]];
  for (let s = 0; s < maxSteps; s++) {
    const gu = (bilinear(d, u + 1, v) - bilinear(d, u - 1, v)) / 2;
    const gv = (bilinear(d, u, v + 1) - bilinear(d, u, v - 1)) / 2;
    if (!Number.isFinite(gu) || !Number.isFinite(gv)) break;
    vu = momentum * vu - lr * gu;
    vv = momentum * vv - lr * gv;
    u = Math.min(Math.max(u + vu, 0), d.nCols - 1);
    v = Math.min(Math.max(v + vv, 0), d.nRows - 1);
    raw.push([d.xs[Math.round(u)], d.ys[Math.round(v)], bilinear(d, u, v)]);
    if (Math.abs(gu) < 1e-7 && Math.abs(gv) < 1e-7 && Math.abs(vu) < 1e-7 && Math.abs(vv) < 1e-7) break;
  }

  if (raw.length <= maxPoints) return raw;
  const out: BallPoint[] = [];
  for (let i = 0; i < maxPoints - 1; i++) {
    out.push(raw[Math.round((i * (raw.length - 1)) / (maxPoints - 1))]);
  }
  out.push(raw[raw.length - 1]);
  return out;
}

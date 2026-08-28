/**
 * 损失景观数据层 —— 与 UI 框架无关的纯函数（配套 landscape.test.ts）。
 *
 * 数据来源：figures 表中 kind='landscape' 的行，body 为 Python SDK
 * `log_loss_landscape()` 写入的 JSON（见 trailer-sdk/trailer/tracker.py）。
 */

export interface LandscapeFigureRow {
  run_id: string;
  step: number;
  name: string;
  kind: string;
  body: string;
}

export interface LandscapeGroup {
  name: string;
  rows: LandscapeFigureRow[];
}

interface LandscapeBody {
  v?: number;
  n_rows: number;
  n_cols: number;
  x_range: [number, number];
  y_range: [number, number];
  z: number[][];
  meta?: Record<string, unknown>;
}

/** 解析后的景观网格：z 为行主序 Float32Array，xs/ys 为含端点的等距轴坐标。 */
export interface ParsedLandscape {
  nRows: number;
  nCols: number;
  xRange: [number, number];
  yRange: [number, number];
  xs: Float64Array;
  ys: Float64Array;
  z: Float32Array;
  zmin: number;
  zmax: number;
  meta: Record<string, unknown>;
}

/** 含端点的等距坐标轴。 */
export function linspace(a: number, b: number, n: number): Float64Array {
  const out = new Float64Array(n);
  const step = n > 1 ? (b - a) / (n - 1) : 0;
  for (let i = 0; i < n; i++) out[i] = a + step * i;
  return out;
}

/** 解析 kind='landscape' 的 figure 行；坏数据一律返回 null，调用方安全降级。 */
export function parseFigureToLandscape(fig: LandscapeFigureRow): ParsedLandscape | null {
  let body: LandscapeBody;
  try {
    body = JSON.parse(fig.body);
  } catch {
    return null;
  }
  const { n_rows: nRows, n_cols: nCols } = body;
  if (!Number.isFinite(nRows) || !Number.isFinite(nCols) || nRows < 2 || nCols < 2) return null;
  if (!Array.isArray(body.z) || body.z.length !== nRows) return null;

  let zmin = Infinity;
  let zmax = -Infinity;
  const z = new Float32Array(nRows * nCols);
  for (let r = 0; r < nRows; r++) {
    const row = body.z[r];
    if (!Array.isArray(row) || row.length !== nCols) return null;
    for (let c = 0; c < nCols; c++) {
      const v = Number(row[c]);
      if (!Number.isFinite(v)) return null;
      z[r * nCols + c] = v;
      if (v < zmin) zmin = v;
      if (v > zmax) zmax = v;
    }
  }

  const xr: [number, number] =
    Array.isArray(body.x_range) && body.x_range.length === 2 ? [body.x_range[0], body.x_range[1]] : [-1, 1];
  const yr: [number, number] =
    Array.isArray(body.y_range) && body.y_range.length === 2 ? [body.y_range[0], body.y_range[1]] : [-1, 1];

  return {
    nRows,
    nCols,
    xRange: xr,
    yRange: yr,
    // 列方向是 α(x)，行方向是 β(y)；z 行主序 => x 对应 n_cols、y 对应 n_rows
    xs: linspace(xr[0], xr[1], nCols),
    ys: linspace(yr[0], yr[1], nRows),
    z,
    zmin,
    zmax,
    meta: (body.meta as Record<string, unknown>) ?? {},
  };
}

/** 按名分组；组按 name 字典序，组内按 step 升序。 */
export function groupLandscapeFigures(rows: LandscapeFigureRow[]): LandscapeGroup[] {
  const byName = new Map<string, LandscapeFigureRow[]>();
  for (const r of rows) {
    const list = byName.get(r.name);
    if (list) list.push(r);
    else byName.set(r.name, [r]);
  }
  return [...byName.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, list]) => ({ name, rows: [...list].sort((a, b) => a.step - b.step) }));
}

// ---- 色彩映射方案 ----
// viridis 9 等分锚点（经典）；magma/plasma 为 matplotlib 同名 colormap 的采样锚点。
const COLORMAP_TABLE: Record<string, ReadonlyArray<readonly [number, number, number]>> = {
  viridis: [
    [68, 1, 84], [71, 45, 123], [59, 82, 139], [44, 114, 142], [33, 145, 140],
    [40, 174, 128], [94, 201, 98], [173, 220, 48], [253, 231, 37],
  ],
  magma: [
    [0, 0, 4], [20, 14, 54], [59, 15, 112], [100, 26, 128], [140, 41, 129],
    [183, 55, 121], [222, 73, 104], [247, 112, 92], [254, 159, 109], [252, 253, 191],
  ],
  plasma: [
    [13, 8, 135], [70, 3, 159], [114, 1, 168], [156, 23, 158], [189, 55, 134],
    [216, 87, 107], [237, 121, 83], [251, 159, 58], [240, 249, 33],
  ],
  coolwarm: [
    [59, 76, 192], [107, 142, 241], [156, 188, 247], [205, 217, 232], [232, 230, 230],
    [242, 209, 194], [237, 168, 150], [221, 115, 96], [180, 4, 38],
  ],
};

export const COLORMAP_NAMES = Object.keys(COLORMAP_TABLE) as string[];
export type ColormapName = (typeof COLORMAP_NAMES)[number];

/**
 * t ∈ [0,1] → 指定方案的 RGB(0-255)，越界 clamp。供热力图/等高线/3D 曲面共用。
 * 默认 coolwarm：整体明亮饱满；magma 偏暗、viridis 经典、coolwarm 浅色发散。
 */
export function colormap(t: number, name: string = 'coolwarm'): [number, number, number] {
  const anchors = COLORMAP_TABLE[name] ?? COLORMAP_TABLE.coolwarm;
  const clamped = Math.min(1, Math.max(0, t));
  const pos = clamped * (anchors.length - 1);
  const i = Math.min(Math.floor(pos), anchors.length - 2);
  const frac = pos - i;
  const a = anchors[i];
  const b = anchors[i + 1];
  return [
    Math.round(a[0] + (b[0] - a[0]) * frac),
    Math.round(a[1] + (b[1] - a[1]) * frac),
    Math.round(a[2] + (b[2] - a[2]) * frac),
  ];
}

/** k 条等值线的阈值：排除两端极值的内部均匀分层（degenerate 输入返回 []）。 */
export function buildContourLevels(zmin: number, zmax: number, k: number): number[] {
  if (!(k > 0) || !(zmax > zmin)) return [];
  const range = zmax - zmin;
  const levels: number[] = [];
  for (let i = 1; i <= k; i++) levels.push(zmin + (range * i) / (k + 1));
  return levels;
}

// ---- 值域缩放（配色 / 等高线分级 / 3D 高度共用）----

export type LandscapeScale = 'linear' | 'log';

export interface LandscapeScaler {
  /** 数据空间 loss → 显示空间 [0,1]（配色、高度、等高线分级必须共用同一缩放） */
  toT(z: number): number;
  /** 显示空间 [0,1] → 数据空间（等高线分级求阈值用） */
  invert(t: number): number;
  mode: LandscapeScale;
}

/**
 * 构造值域缩放器。linear 为常规 min-max；log 用偏移对数 log1p(z - zmin + ε)——
 * 碗底（低 loss 区）的细节被放大，极端"墙"不再压扁整幅图的色阶。
 * 负值数据（手动网格）经 zmin 偏移同样支持；常值网格退化为恒 0。
 */
export function makeLandscapeScaler(
  zmin: number,
  zmax: number,
  mode: LandscapeScale = 'linear',
): LandscapeScaler {
  const range = zmax - zmin;
  if (mode !== 'log' || !(range > 0)) {
    return {
      mode: range > 0 ? mode : 'linear',
      toT: (z) => (range > 0 ? Math.min(1, Math.max(0, (z - zmin) / range)) : 0),
      invert: (t) => zmin + Math.min(1, Math.max(0, t)) * range,
    };
  }
  const eps = Math.max(range * 1e-9, 1e-12);
  const lo = Math.log1p(eps);
  const span = Math.log1p(range + eps) - lo;
  return {
    mode,
    toT: (z) => {
      const t = (Math.log1p(Math.max(z, zmin) - zmin + eps) - lo) / span;
      return Math.min(1, Math.max(0, t));
    },
    invert: (t) => zmin + Math.expm1(lo + Math.min(1, Math.max(0, t)) * span) - eps,
  };
}

/** k 条等值线阈值：显示空间均匀分层后映射回数据空间（log 刻度时低区更密）。 */
export function buildContourLevelsScaled(scaler: LandscapeScaler, k: number): number[] {
  if (!(k > 0)) return [];
  const levels: number[] = [];
  for (let i = 1; i <= k; i++) levels.push(scaler.invert(i / (k + 1)));
  return levels[0] === levels[levels.length - 1] ? [] : levels;
}

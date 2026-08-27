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

function linspace(a: number, b: number, n: number): Float64Array {
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

// viridis 色 LUT 锚点（9 等分采样，与 matplotlib viridis 一致）
const VIRIDIS_ANCHORS: ReadonlyArray<readonly [number, number, number]> = [
  [68, 1, 84],
  [71, 45, 123],
  [59, 82, 139],
  [44, 114, 142],
  [33, 145, 140],
  [40, 174, 128],
  [94, 201, 98],
  [173, 220, 48],
  [253, 231, 37],
];

/** t ∈ [0,1] → viridis RGB(0-255)，越界 clamp。供热力图/等高线/3D 曲面共用。 */
export function colormap(t: number): [number, number, number] {
  const clamped = Math.min(1, Math.max(0, t));
  const pos = clamped * (VIRIDIS_ANCHORS.length - 1);
  const i = Math.min(Math.floor(pos), VIRIDIS_ANCHORS.length - 2);
  const frac = pos - i;
  const a = VIRIDIS_ANCHORS[i];
  const b = VIRIDIS_ANCHORS[i + 1];
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

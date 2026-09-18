// ─── Boards 训练回放:纯函数层(截断/定位/范围) ───
// BoardsPanel 派生 viewMetrics/viewBoardsData 时使用,下游 widget 零感知截断。
import type { BoardsData, MetricSeries } from '../components/boards/boardsData';

/** 全部数据源(metrics + 五类 boardsData)的全局 step 极值;无任何数据时 null */
export function dataStepRange(
  metrics: MetricSeries[],
  data: BoardsData
): { min: number; max: number } | null {
  let min = Infinity;
  let max = -Infinity;
  const touch = (step: number) => {
    if (step < min) min = step;
    if (step > max) max = step;
  };
  for (const g of metrics) for (const p of g.points) touch(p.step);
  for (const h of data.histograms) touch(h.step);
  for (const f of data.figures) touch(f.step);
  for (const t of data.texts) touch(t.step);
  for (const t of data.tables) touch(t.step);
  for (const m of data.media) touch(m.step);
  return min === Infinity ? null : { min, max };
}

/** 截断每条 series 的 points 到 step ≤ S;S 覆盖全部点时返回原引用(step 不变 → 无重渲染) */
export function clipMetrics(metrics: MetricSeries[], step: number): MetricSeries[] {
  let untouched = true;
  const out = metrics.map((g) => {
    let cut = g.points.length;
    // points 按 step 有序(append-only 合并),从尾部找第一个 > step 的位置即可
    while (cut > 0 && g.points[cut - 1].step > step) cut--;
    if (cut < g.points.length) untouched = false;
    return cut === g.points.length ? g : { ...g, points: g.points.slice(0, cut) };
  });
  return untouched ? metrics : out;
}

/** 五类 boardsData rows 统一过滤 step ≤ S;无截断时返回原引用 */
export function clipBoardsData(data: BoardsData, step: number): BoardsData {
  const clip = <T extends { step: number }>(rows: T[]): T[] | null => {
    let cut = rows.length;
    let unordered = false;
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].step > step) {
        cut = i;
        break;
      }
      // rows 无序时退化为全量过滤
      if (i > 0 && rows[i].step < rows[i - 1].step) unordered = true;
    }
    if (unordered) {
      const kept = rows.filter((r) => r.step <= step);
      return kept.length === rows.length ? null : kept;
    }
    return cut === rows.length ? null : rows.slice(0, cut);
  };
  const histograms = clip(data.histograms);
  const figures = clip(data.figures);
  const texts = clip(data.texts);
  const tables = clip(data.tables);
  const media = clip(data.media);
  if (
    histograms === null &&
    figures === null &&
    texts === null &&
    tables === null &&
    media === null
  ) {
    return data;
  }
  return {
    histograms: histograms ?? data.histograms,
    figures: figures ?? data.figures,
    texts: texts ?? data.texts,
    tables: tables ?? data.tables,
    media: media ?? data.media,
  };
}

/** 升序 steps 中最后一个 ≤ follow 的下标;空数组或 follow 小于全部时返回 0 */
export function followIndex(steps: number[], follow: number): number {
  let idx = 0;
  for (let i = 0; i < steps.length; i++) {
    if (steps[i] <= follow) idx = i;
    else break;
  }
  return idx;
}

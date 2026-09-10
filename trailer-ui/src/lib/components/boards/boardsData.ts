import type { HistogramPoint } from '$lib/charts/HistogramChart.svelte';

// ─── Boards 面板的数据层:run 页五类 log 的列表拉取与增量合并 ───
// row 类型与各 Explorer 内部定义保持同构(figures/texts/media 无 id 的以 name+step 引用)

export interface FigureRow {
  run_id: string;
  step: number;
  name: string;
  kind: 'png' | 'g2';
  body: string;
}

export interface TextRow {
  run_id: string;
  step: number;
  name: string;
  body: string;
}

export interface TableRow {
  id: number;
  run_id: string;
  step: number;
  name: string;
  columns: string[];
  data: unknown[][];
  row_count: number;
}

export interface MediaRow {
  id: number;
  run_id: string;
  step: number;
  name: string;
  kind: 'image' | 'video' | 'audio';
  ext: string;
  size: number;
}

export interface MetricSeries {
  key: string;
  context: string;
  points: Array<{ step: number; value: number; idx: number; wall_time?: number }>;
}

export interface BoardsData {
  histograms: HistogramPoint[];
  figures: FigureRow[];
  texts: TextRow[];
  tables: TableRow[];
  media: MediaRow[];
}

export const EMPTY_BOARDS_DATA: BoardsData = {
  histograms: [],
  figures: [],
  texts: [],
  tables: [],
  media: [],
};

async function getJson<T>(url: string): Promise<T[]> {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return (await resp.json()) as T[];
}

/**
 * 拉取五类 log 列表。histograms 传 prev 时按 key|context|step 增量合并
 * (与 HistogramExplorer 一致,避免轮询重置);其余整体替换。
 */
export async function fetchBoardsData(runId: string, prev?: BoardsData): Promise<BoardsData> {
  const enc = encodeURIComponent(runId);
  const safe = async <T>(p: Promise<T[]>, fallback: T[]): Promise<T[]> => {
    try {
      return await p;
    } catch {
      return fallback;
    }
  };
  const [histograms, figures, texts, tables, media] = await Promise.all([
    safe(getJson(`/api/v1/runs/${enc}/histograms`), prev?.histograms ?? []),
    safe(getJson<FigureRow[]>(`/api/v1/runs/${enc}/figures`), prev?.figures ?? []),
    safe(getJson<TextRow[]>(`/api/v1/runs/${enc}/texts`), prev?.texts ?? []),
    safe(getJson<TableRow[]>(`/api/v1/runs/${enc}/tables`), prev?.tables ?? []),
    safe(getJson<MediaRow[]>(`/api/v1/runs/${enc}/media`), prev?.media ?? []),
  ]);
  let mergedHist = histograms;
  if (prev && histograms.length === 0 && prev.histograms.length > 0) {
    mergedHist = prev.histograms;
  } else if (prev) {
    // 增量合并:histograms 端点失败时回退 prev,成功时并入新 step
    const seen = new Set(prev.histograms.map((h) => `${h.key}|${h.context}|${h.step}`));
    mergedHist = [...prev.histograms];
    for (const h of histograms) {
      const k = `${h.key}|${h.context}|${h.step}`;
      if (!seen.has(k)) {
        mergedHist.push(h);
        seen.add(k);
      }
    }
  }
  return { histograms: mergedHist, figures, texts, tables, media };
}

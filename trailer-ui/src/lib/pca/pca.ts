import type { PcaData, PcaFigureRow, PcaGroup } from './pcaTypes';

/** 解析 figures body（JSON 字符串）→ PcaData；非法 JSON 返回 null */
export function parsePcaBody(body: string): PcaData | null {
  try {
    const parsed = JSON.parse(body);
    return parsed && Array.isArray(parsed.points) ? parsed : null;
  } catch {
    return null;
  }
}

/** 按 name 分组，组内按 step 升序，组间按 name 排序 */
export function groupPcaFigures(rows: PcaFigureRow[]): PcaGroup[] {
  const map = new Map<string, PcaFigureRow[]>();
  for (const r of rows) {
    const list = map.get(r.name);
    if (list) list.push(r);
    else map.set(r.name, [r]);
  }
  return [...map.entries()]
    .map(([name, list]) => ({ name, rows: [...list].sort((a, b) => a.step - b.step) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

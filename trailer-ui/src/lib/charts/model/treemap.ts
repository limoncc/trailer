/** Squarified treemap layout (Bruls et al.) for the inspector's
 *  "parameters by child" view — area ∝ parameter count. */

export interface TreemapItem {
  id: string;
  label: string;
  value: number;
}

export interface TreemapRect {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

function worst(row: number[], length: number, scale: number): number {
  const sum = row.reduce((a, b) => a + b, 0);
  const max = Math.max(...row);
  const min = Math.min(...row);
  return Math.max((length * length * max) / (sum * sum), (sum * sum) / (length * length * min));
}

/** Lay items out in a w×h rectangle, area proportional to value. */
export function squarify(items: TreemapItem[], w: number, h: number): TreemapRect[] {
  const positive = items.filter((it) => it.value > 0);
  if (!positive.length || w <= 0 || h <= 0) return [];

  const total = positive.reduce((a, b) => a + b.value, 0);
  const scale = (w * h) / total;
  // 面积(归一到容器尺寸)降序
  const queue = [...positive]
    .sort((a, b) => b.value - a.value)
    .map((it) => ({ ...it, area: it.value * scale }));

  const out: TreemapRect[] = [];
  let x = 0;
  let y = 0;
  let restW = w;
  let restH = h;

  while (queue.length) {
    const length = Math.min(restW, restH);
    const row: typeof queue = [];
    let rowAreas: number[] = [];
    // 贪心:逐个加入当前行,直到宽比变差
    while (queue.length) {
      const candidate = queue[0];
      const nextAreas = [...rowAreas, candidate.area];
      if (!rowAreas.length || worst(nextAreas, length, scale) <= worst(rowAreas, length, scale)) {
        row.push(queue.shift()!);
        rowAreas = nextAreas;
      } else break;
    }
    const rowSum = rowAreas.reduce((a, b) => a + b, 0);
    const thickness = rowSum / length;
    let offset = 0;
    if (restW >= restH) {
      // 行竖排在左侧(thickness 沿 x)
      for (const it of row) {
        const ih = it.area / thickness;
        out.push({ id: it.id, x, y: y + offset, w: thickness, h: ih });
        offset += ih;
      }
      x += thickness;
      restW -= thickness;
    } else {
      // 行横排在顶部(thickness 沿 y)
      for (const it of row) {
        const iw = it.area / thickness;
        out.push({ id: it.id, x: x + offset, y, w: iw, h: thickness });
        offset += iw;
      }
      y += thickness;
      restH -= thickness;
    }
  }
  return out;
}

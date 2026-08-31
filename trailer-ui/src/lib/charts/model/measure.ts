/** Real text measurement via an offscreen canvas 2d context.
 *
 *  Replaces the old char-count width heuristic (`charCode > 255 ? size :
 *  size*0.62`) that overflowed on CJK and long module names. Falls back to
 *  the heuristic when no canvas context is available (tests / SSR). */
export type Measurer = (text: string, size: number, weight?: number) => number;

let ctx: CanvasRenderingContext2D | null | undefined;

function getCtx(): CanvasRenderingContext2D | null {
  if (ctx === undefined) {
    try {
      ctx = document.createElement('canvas').getContext('2d');
    } catch {
      ctx = null;
    }
  }
  return ctx ?? null;
}

export function canvasMeasure(text: string, size: number, weight = 400): number {
  const c = getCtx();
  if (!c) return text.length * size * 0.62;
  c.font = `${weight} ${size}px ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif`;
  return c.measureText(text).width;
}

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

/** 与 leafer Text 渲染保持一致的字体栈(设置 fontFamily 时用同一字符串) */
export const FONT_STACK = "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

export function canvasMeasure(text: string, size: number, weight = 400): number {
  const c = getCtx();
  if (!c) return text.length * size * 0.62;
  c.font = `${weight} ${size}px ${FONT_STACK}`;
  // +10%/+12px 安全余量:leafer 的文本渲染宽度略大于 canvas 测量(字体回退与
  // hinting 差异),长 shape 字符串(如 IO 行)否则会溢出盒子右边框
  return c.measureText(text).width * 1.1 + 12;
}

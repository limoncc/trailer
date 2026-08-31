/** Export the laid-out graph as SVG (same geometry as the canvas, no leafer),
 *  PNG (2× raster of that SVG) or the raw JSON document. */
import { displayName, subLabel, ioLabel, type LayoutResult, type Spec, type GraphNode } from './layout';
import { colorFor, guessKind, type Kind } from './kinds';

const EDGE_STYLE: Record<string, { color: string; width: number; dash: string }> = {
  routing: { color: '#d946ef', width: 1.9, dash: '6 4' },
  residual: { color: '#f59e0b', width: 1.6, dash: '' },
  loop: { color: '#8b5cf6', width: 1.4, dash: '5 4' },
  order: { color: '#cbd5e1', width: 1.2, dash: '3 3' },
  seq: { color: '#cbd5e1', width: 1.2, dash: '3 3' },
  tensor: { color: '#64748b', width: 1.7, dash: '' },
};

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function buildSvg(layout: LayoutResult, spec: Spec, opts: { dark?: boolean } = {}): string {
  const dark = !!opts.dark;
  const b = layout.bounds;
  const m = 70; // room for IO pills
  const W = Math.max(1, b.maxX - b.minX + m * 2);
  const H = Math.max(1, b.maxY - b.minY + m * 2);
  const bg = dark ? '#1a1a2e' : '#fafafa';
  const subText = dark ? '#64748b' : '#94a3b8';
  const ioText = dark ? '#475569' : '#b0b7c3';

  const out: string[] = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W.toFixed(0)}" height="${H.toFixed(0)}" viewBox="${(b.minX - m).toFixed(1)} ${(b.minY - m).toFixed(1)} ${W.toFixed(1)} ${H.toFixed(1)}" font-family="ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif">`);
  out.push(`<rect x="${(b.minX - m).toFixed(1)}" y="${(b.minY - m).toFixed(1)}" width="${W.toFixed(1)}" height="${H.toFixed(1)}" fill="${bg}"/>`);
  out.push(`<defs><marker id="arr" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L7,3 L0,6 z" fill="${dark ? '#64748b' : '#94a3b8'}"/></marker></defs>`);

  const ordered = Object.values(layout.boxes).sort((x, y) => x.depth - y.depth);
  // boxes
  for (const box of ordered) {
    const n = box.node as GraphNode;
    const kindKey = (n.kind && KIND_KEYS.has(n.kind) ? n.kind : guessKindOf(n)) as Kind;
    const pal = colorFor(kindKey, dark);
    const expanded = !!(n.children?.length);
    out.push(`<rect data-id="${esc(box.id)}" x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" rx="${expanded ? 8 : 5}" fill="${pal.fill}" stroke="${pal.stroke}" stroke-width="${box.depth === 0 ? 2 : 1.2}"/>`);
    if (expanded) {
      out.push(`<text data-id="${esc(box.id)}-name" x="${box.x + 12}" y="${box.y + 18}" font-size="13" font-weight="600" fill="${pal.label}">${esc(displayName(n))}</text>`);
      out.push(`<text x="${box.x + 12}" y="${box.y + 32}" font-size="10.5" fill="${subText}">${esc(subLabel(n))}</text>`);
    } else if (n.children?.length) {
      out.push(`<text x="${box.x + 12}" y="${box.y + 17}" font-size="12.5" font-weight="600" fill="${pal.label}">${esc(displayName(n))}</text>`);
      out.push(`<text x="${box.x + 12}" y="${box.y + 33}" font-size="10" fill="${subText}">${esc(subLabel(n))}</text>`);
    } else {
      out.push(`<text x="${box.x + box.w / 2}" y="${box.y + 17}" font-size="12" font-weight="600" text-anchor="middle" fill="${pal.label}">${esc(displayName(n))}</text>`);
      out.push(`<text x="${box.x + box.w / 2}" y="${box.y + 31}" font-size="10" text-anchor="middle" fill="${subText}">${esc(subLabel(n))}</text>`);
      const io = ioLabel(n);
      if (io) out.push(`<text x="${box.x + box.w / 2}" y="${box.y + 44}" font-size="9.5" text-anchor="middle" fill="${ioText}">${esc(io)}</text>`);
    }
  }

  // edges on top of boxes
  for (const rt of layout.routes) {
    const st = EDGE_STYLE[rt.kind] ?? EDGE_STYLE.tensor;
    out.push(`<path d="${rt.path}" fill="none" stroke="${st.color}" stroke-width="${st.width}"${st.dash ? ` stroke-dasharray="${st.dash}"` : ''} marker-end="url(#arr)"/>`);
    if (rt.kind === 'routing' && rt.shape) {
      out.push(`<rect x="${(rt.mx - 26).toFixed(1)}" y="${(rt.my - 7).toFixed(1)}" width="52" height="14" rx="7" fill="${dark ? '#3b1f6e' : '#fdf2f8'}" stroke="${st.color}" stroke-width="0.8"/>`);
      out.push(`<text x="${rt.mx.toFixed(1)}" y="${(rt.my + 3).toFixed(1)}" font-size="8.5" text-anchor="middle" fill="${dark ? '#f9a8d4' : '#be185d'}">${esc(rt.shape)}</text>`);
    }
  }

  if (spec.meta?.name) {
    out.push(`<text x="${(b.minX - m + 12).toFixed(1)}" y="${(b.minY - m + 24).toFixed(1)}" font-size="14" font-weight="700" fill="${dark ? '#e2e8f0' : '#334155'}">${esc(String(spec.meta.name))}${spec.meta.total_params_fmt ? `<tspan font-weight="400" fill="${subText}"> · ${esc(String(spec.meta.total_params_fmt))}</tspan>` : ''}</text>`);
  }
  out.push('</svg>');
  return out.join('\n');
}

const KIND_KEYS = new Set(['embedding', 'attention', 'mlp', 'moe', 'norm', 'linear', 'conv', 'head', 'act', 'container', 'module']);
function guessKindOf(n: GraphNode): string {
  return guessKind(n);
}

export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function downloadSvg(layout: LayoutResult, spec: Spec, dark = false): void {
  const svg = buildSvg(layout, spec, { dark });
  downloadBlob(`${spec.meta?.name || 'model'}-graph.svg`, new Blob([svg], { type: 'image/svg+xml' }));
}

export async function downloadPng(layout: LayoutResult, spec: Spec, dark = false, scale = 2): Promise<void> {
  const svg = buildSvg(layout, spec, { dark });
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    await new Promise<void>((res, rej) => {
      img.onload = () => res();
      img.onerror = () => rej(new Error('svg raster failed'));
      img.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth * scale;
    canvas.height = img.naturalHeight * scale;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0);
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'));
    if (blob) downloadBlob(`${spec.meta?.name || 'model'}-graph.png`, blob);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function downloadJson(spec: Spec): void {
  downloadBlob(`${spec.meta?.name || 'model'}-graph.json`, new Blob([JSON.stringify(spec, null, 1)], { type: 'application/json' }));
}

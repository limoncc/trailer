/** Kind → color table. The SDK classifies nodes (node.kind, format v2);
 *  `guessKind` re-derives it from class-name substrings for figures logged
 *  before kinds existed. Legend and canvas share this one table. */

export type Kind =
  | 'embedding' | 'attention' | 'mlp' | 'moe' | 'norm' | 'linear'
  | 'conv' | 'head' | 'act' | 'container' | 'module';

export interface KindPalette {
  fill: string;
  stroke: string;
  label: string;
}

export const KIND_COLORS: Record<Kind, { light: KindPalette; dark: KindPalette }> = {
  embedding: { light: { fill: '#dbeafe', stroke: '#3b82f6', label: '#1e40af' }, dark: { fill: '#1e3a5f', stroke: '#60a5fa', label: '#93c5fd' } },
  attention: { light: { fill: '#f3e8ff', stroke: '#8b5cf6', label: '#5b21b6' }, dark: { fill: '#3b1f6e', stroke: '#a78bfa', label: '#c4b5fd' } },
  mlp:       { light: { fill: '#fce7f3', stroke: '#ec4899', label: '#9d174d' }, dark: { fill: '#831843', stroke: '#f472b6', label: '#f9a8d4' } },
  moe:       { light: { fill: '#fdf2f8', stroke: '#d946ef', label: '#a21caf' }, dark: { fill: '#701a43', stroke: '#e879f9', label: '#f5d0fe' } },
  norm:      { light: { fill: '#ccfbf1', stroke: '#14b8a6', label: '#0f766e' }, dark: { fill: '#134e4a', stroke: '#2dd4bf', label: '#5eead4' } },
  linear:    { light: { fill: '#ffffff', stroke: '#cbd5e1', label: '#64748b' }, dark: { fill: '#0f172a', stroke: '#475569', label: '#94a3b8' } },
  conv:      { light: { fill: '#dcfce7', stroke: '#22c55e', label: '#166534' }, dark: { fill: '#14532d', stroke: '#4ade80', label: '#86efac' } },
  head:      { light: { fill: '#fef3c7', stroke: '#f59e0b', label: '#92400e' }, dark: { fill: '#78350f', stroke: '#fbbf24', label: '#fcd34d' } },
  act:       { light: { fill: '#f1f5f9', stroke: '#94a3b8', label: '#64748b' }, dark: { fill: '#1e293b', stroke: '#64748b', label: '#94a3b8' } },
  container: { light: { fill: '#ffffff', stroke: '#cbd5e1', label: '#475569' }, dark: { fill: '#0f172a', stroke: '#334155', label: '#94a3b8' } },
  module:    { light: { fill: '#ffffff', stroke: '#cbd5e1', label: '#64748b' }, dark: { fill: '#0f172a', stroke: '#334155', label: '#94a3b8' } },
};

export const KIND_LEGEND: Array<{ kind: Kind; label: string }> = [
  { kind: 'embedding', label: 'Embed' },
  { kind: 'attention', label: 'Attn' },
  { kind: 'mlp', label: 'MLP' },
  { kind: 'moe', label: 'MoE' },
  { kind: 'norm', label: 'Norm' },
  { kind: 'conv', label: 'Conv' },
  { kind: 'head', label: 'Head' },
];

const ACT_WORDS = ['gelu', 'relu', 'silu', 'swiglu', 'tanh', 'sigmoid', 'softmax', 'dropout', 'pool', 'identity', 'flatten', 'act'];

/** class-name fallback for graphs without node.kind (format < 2) */
export function guessKind(n: { class?: string; name?: string; children?: unknown[] }): Kind {
  const c = (n.class || '').toLowerCase();
  const nm = (n.name || '').toLowerCase();
  if (c.includes('embed')) return 'embedding';
  if (c.includes('attention') || c.includes('attn') || nm.includes('attn')) return 'attention';
  if (c.includes('norm')) return 'norm';
  if (c.includes('conv')) return 'conv';
  if (nm.includes('head') || nm === 'classifier' || nm === 'fc') return 'head';
  if (c.includes('mlp') || c.includes('feedforward') || nm.includes('mlp')) return 'mlp';
  if (c === 'linear') return 'linear';
  if (ACT_WORDS.some((w) => c.includes(w))) return 'act';
  return n.children?.length ? 'container' : 'module';
}

export function colorFor(kind: string, dark: boolean): KindPalette {
  const entry = (KIND_COLORS as Record<string, { light: KindPalette; dark: KindPalette }>)[kind];
  const pal = entry ?? KIND_COLORS.module;
  return dark ? pal.dark : pal.light;
}

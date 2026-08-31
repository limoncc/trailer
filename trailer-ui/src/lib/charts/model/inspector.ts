/** Formatting + shape-semantics helpers for the model inspector panel.
 *
 *  Dim labels are matched by VALUE against the node's extra_repr attrs
 *  ("512 in_features"); when two attribute names claim the same value the
 *  label is dropped — wrong beats unlabeled, never the reverse (borrowed from
 *  modelmap's buildDimLabels). */

export function fmtInt(n: number): string {
  return n.toLocaleString('en-US');
}

export function fmtPct(part: number, total: number): string {
  if (!total) return '—';
  const p = (part / total) * 100;
  return (p >= 100 ? p.toFixed(0) : p.toFixed(1).replace(/\.0$/, '')) + '%';
}

const DTYPE_BYTES: Record<string, number> = {
  float64: 8, float32: 4, float16: 2, bfloat16: 2,
  int64: 8, int32: 4, int16: 2, int8: 1, int4: 0.5, uint8: 1, bool: 1,
  fp64: 8, fp32: 4, fp16: 2, bf16: 2, i64: 8, i32: 4, i16: 2, i8: 1, i4: 0.5,
};

const DTYPE_SHORT: Record<string, string> = {
  float64: 'fp64', float32: 'fp32', float16: 'fp16', bfloat16: 'bf16',
  int64: 'i64', int32: 'i32', int16: 'i16', int8: 'i8', int4: 'i4',
  uint8: 'u8', bool: 'bool', fp64: 'fp64', fp32: 'fp32', fp16: 'fp16', bf16: 'bf16',
};

export function dtypeLabel(dtype: string | null | undefined): string {
  if (!dtype) return '';
  const short = DTYPE_SHORT[dtype];
  if (!short) return dtype;
  const bytes = DTYPE_BYTES[dtype];
  return bytes != null ? `${short} · ${bytes < 1 ? bytes.toFixed(1) : bytes} B` : short;
}

/** "0, 1, 2, 3" · "members 0…35" · "members 0, 1, 3, 5 … 41 — interleaved" */
export function fmtMembers(members: string[]): string {
  if (!members.length) return '';
  const nums = members.map(Number);
  const contiguous = nums.every((n, i) => !Number.isNaN(n) && (i === 0 || n === nums[i - 1] + 1));
  if (contiguous || members.length <= 4)
    return members.length <= 4 ? members.join(', ') : `members ${members[0]}…${members[members.length - 1]}`;
  return `members ${members.slice(0, 4).join(', ')} … ${members[members.length - 1]} — interleaved`;
}

export interface ParsedShape {
  dims: number[];
  dtype: string | null;
}

/** parse traced io strings produced by the SDK: "(2, 8) float32" */
export function parseShape(s: string): ParsedShape {
  const out: ParsedShape = { dims: [], dtype: null };
  if (!s) return out;
  const open = s.indexOf('(');
  const close = s.indexOf(')');
  if (open >= 0 && close > open) {
    for (const part of s.slice(open + 1, close).split(',')) {
      const v = Number(part.trim());
      if (!Number.isNaN(v)) out.dims.push(v);
    }
    const tail = (s.slice(close + 1) || '').trim();
    out.dtype = tail || null;
  }
  return out;
}

/** value-matched dim labels from the node's attrs; ambiguous values dropped */
export function buildDimLabels(
  attrEntries: Array<[string, unknown]>,
  values: Iterable<number>,
): Map<number, string> {
  const claims = new Map<number, Set<string>>();
  for (const [k, v] of attrEntries) {
    if (typeof v !== 'number') {
      const n = Number(v);
      if (Number.isNaN(n)) continue;
    }
    const set = claims.get(v as number) ?? new Set<string>();
    set.add(k);
    claims.set(v as number, set);
  }
  const out = new Map<number, string>();
  for (const v of values) {
    const names = claims.get(v);
    if (names && names.size === 1) out.set(v, [...names][0]);
  }
  return out;
}

export interface ShapePart {
  text: string;
  muted: boolean;
}

/** render dims as parts; the leading `batchDims` dims render muted */
export function shapeParts(
  dims: number[],
  labels: Map<number, string>,
  batchDims = 1,
): ShapePart[] {
  return dims.map((d, i) => ({
    text: labels.has(d) ? `${d} ${labels.get(d)}` : String(d),
    muted: i < batchDims,
  }));
}

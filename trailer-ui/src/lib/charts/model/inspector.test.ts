import { describe, it, expect } from 'vitest';
import {
  fmtInt,
  fmtPct,
  dtypeLabel,
  fmtMembers,
  parseShape,
  buildDimLabels,
  shapeParts,
} from './inspector';

describe('fmtInt', () => {
  it('groups thousands', () => {
    expect(fmtInt(1234567)).toBe('1,234,567');
    expect(fmtInt(999)).toBe('999');
  });
});

describe('fmtPct', () => {
  it('formats share of total with one decimal', () => {
    expect(fmtPct(300, 12345)).toBe('2.4%');
    expect(fmtPct(0, 12345)).toBe('0%');
    expect(fmtPct(5, 0)).toBe('—');
  });
});

describe('dtypeLabel', () => {
  it('shortens common dtypes with byte width', () => {
    expect(dtypeLabel('float32')).toBe('fp32 · 4 B');
    expect(dtypeLabel('float16')).toBe('fp16 · 2 B');
    expect(dtypeLabel('bfloat16')).toBe('bf16 · 2 B');
    expect(dtypeLabel('float64')).toBe('fp64 · 8 B');
    expect(dtypeLabel('int8')).toBe('i8 · 1 B');
    expect(dtypeLabel('int4')).toBe('i4 · 0.5 B');
  });
  it('passes unknown dtypes through', () => {
    expect(dtypeLabel('mxfp4')).toBe('mxfp4');
    expect(dtypeLabel('')).toBe('');
  });
});

describe('fmtMembers', () => {
  it('joins short member lists', () => {
    expect(fmtMembers(['0', '1', '2', '3'])).toBe('0, 1, 2, 3');
  });
  it('summarises long contiguous runs', () => {
    expect(fmtMembers(Array.from({ length: 36 }, (_, i) => String(i)))).toBe('members 0…35');
  });
  it('flags interleaved members', () => {
    expect(fmtMembers(['0', '1', '3', '5', '7', '41'])).toBe('members 0, 1, 3, 5 … 41 — interleaved');
  });
});

describe('parseShape', () => {
  it('parses traced io strings', () => {
    expect(parseShape('(2, 8) float32')).toEqual({ dims: [2, 8], dtype: 'float32' });
    expect(parseShape('(128, 4096) bfloat16')).toEqual({ dims: [128, 4096], dtype: 'bfloat16' });
  });
  it('tolerates symbolic dims', () => {
    expect(parseShape('(*, 512) float32')).toEqual({ dims: [512], dtype: 'float32' });
    expect(parseShape('(3, 3, 3)')).toEqual({ dims: [3, 3, 3], dtype: null });
  });
});

describe('buildDimLabels', () => {
  it('labels dimensions by matching attribute values', () => {
    const labels = buildDimLabels([['in_features', 512], ['out_features', 2048]], [2, 512, 2048]);
    expect(labels.get(512)).toBe('in_features');
    expect(labels.get(2048)).toBe('out_features');
    expect(labels.has(2)).toBe(false);
  });
  it('drops labels when two attribute names claim the same value', () => {
    const labels = buildDimLabels([['in_features', 512], ['out_features', 512]], [512]);
    expect(labels.has(512)).toBe(false);
  });
});

describe('shapeParts', () => {
  it('marks leading batch dims as muted and appends dim labels', () => {
    const labels = buildDimLabels([['in_features', 512]], [2, 512]);
    const parts = shapeParts([2, 512], labels, 1);
    expect(parts[0]).toEqual({ text: '2', muted: true });
    expect(parts[1]).toEqual({ text: '512 in_features', muted: false });
  });
  it('renders unlabeled dims plainly', () => {
    const parts = shapeParts([8], buildDimLabels([], [8]), 0);
    expect(parts).toEqual([{ text: '8', muted: false }]);
  });
});

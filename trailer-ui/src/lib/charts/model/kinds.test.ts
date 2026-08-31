import { describe, it, expect } from 'vitest';
import { KIND_COLORS, KIND_LEGEND, colorFor, guessKind } from './kinds';

const ALL_KINDS = ['embedding', 'attention', 'mlp', 'moe', 'norm', 'linear', 'conv', 'head', 'act', 'container', 'module'];

describe('KIND_COLORS', () => {
  it('covers every known kind for both themes', () => {
    for (const k of ALL_KINDS) {
      expect(KIND_COLORS[k], `missing ${k}`).toBeTruthy();
      expect(KIND_COLORS[k].light.fill).toMatch(/^#/);
      expect(KIND_COLORS[k].dark.fill).toMatch(/^#/);
    }
  });
});

describe('colorFor', () => {
  it('returns theme variants', () => {
    expect(colorFor('attention', false).fill).not.toBe(colorFor('attention', true).fill);
  });
  it('falls back to the module palette for unknown kinds', () => {
    expect(colorFor('whatever', false)).toEqual(KIND_COLORS.module.light);
  });
});

describe('KIND_LEGEND', () => {
  it('only lists known kinds with labels', () => {
    expect(KIND_LEGEND.length).toBeGreaterThan(4);
    for (const e of KIND_LEGEND) expect(ALL_KINDS).toContain(e.kind);
  });
});

describe('guessKind (fallback for figures logged before kinds existed)', () => {
  it('matches class-name substrings', () => {
    expect(guessKind({ class: 'Qwen3Attention' })).toBe('attention');
    expect(guessKind({ name: 'self_attn' })).toBe('attention');
    expect(guessKind({ class: 'RMSNorm' })).toBe('norm');
    expect(guessKind({ class: 'Conv1d' })).toBe('conv');
    expect(guessKind({ name: 'lm_head' })).toBe('head');
    expect(guessKind({ class: 'MlpBlock' })).toBe('mlp');
    expect(guessKind({ class: 'GELU' })).toBe('act');
    expect(guessKind({ class: 'Linear' })).toBe('linear');
    expect(guessKind({ class: 'Whatever', children: [{}] })).toBe('container');
    expect(guessKind({ class: 'Whatever' })).toBe('module');
  });
});

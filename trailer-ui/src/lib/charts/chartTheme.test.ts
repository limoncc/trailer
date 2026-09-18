import { describe, it, expect } from 'vitest';
import { formatAxisTick } from './chartTheme.svelte';

describe('formatAxisTick', () => {
  it('keeps integers untouched', () => {
    expect(formatAxisTick(5000)).toBe('5000');
    expect(formatAxisTick(0)).toBe('0');
    expect(formatAxisTick(-2)).toBe('-2');
  });

  it('trims long float tails to significant digits', () => {
    // hist bucket 中点浮点长尾(-0.06000000000000001)是轴标签的主要体验问题
    expect(formatAxisTick(-0.06000000000000001)).toBe('-0.06');
    expect(formatAxisTick(0.123456789)).toBe('0.1235');
    expect(formatAxisTick(0.05832199999)).toBe('0.05832');
  });

  it('handles large and non-finite values', () => {
    expect(formatAxisTick(1234.5678)).toBe('1235');
    expect(formatAxisTick(NaN)).toBe('NaN');
    expect(formatAxisTick(Infinity)).toBe('Infinity');
  });
});

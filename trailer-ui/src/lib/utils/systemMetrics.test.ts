import { describe, it, expect } from 'vitest';
import {
  isSystemContext,
  isDeviceContext,
  canonicalKey,
  displayMetricName,
  formatSystemValue,
  systemAxisFormatter,
} from './systemMetrics';

describe('isSystemContext / isDeviceContext', () => {
  it('classifies system contexts', () => {
    expect(isSystemContext('system')).toBe(true);
    expect(isSystemContext('system/nvidia/gpu0')).toBe(true);
    expect(isSystemContext('train')).toBe(false);
    expect(isSystemContext('')).toBe(false);
  });

  it('device context requires a segment beyond system/', () => {
    expect(isDeviceContext('system')).toBe(false);
    expect(isDeviceContext('system/cpu')).toBe(false);
    expect(isDeviceContext('system/nvidia/gpu0')).toBe(true);
    expect(isDeviceContext('train')).toBe(false);
  });
});

describe('canonicalKey', () => {
  it('maps legacy gpu keys to new names', () => {
    expect(canonicalKey('util', 'system/nvidia/gpu0')).toBe('gpu_util');
    expect(canonicalKey('temperature', 'system/nvidia/gpu0')).toBe('temp_c');
    expect(canonicalKey('power', 'system/apple/gpu0')).toBe('power_w');
    expect(canonicalKey('cpu', 'system')).toBe('cpu_util');
  });

  it('distinguishes host memory from VRAM by context depth', () => {
    expect(canonicalKey('mem_used', 'system')).toBe('mem_used');
    expect(canonicalKey('mem_used', 'system/nvidia/gpu0')).toBe('vram_used');
    expect(canonicalKey('mem_used_prop', 'system')).toBe('mem_util');
    expect(canonicalKey('mem_used_prop', 'system/nvidia/gpu0')).toBe('vram_util');
  });

  it('keeps new names untouched', () => {
    expect(canonicalKey('vram_used', 'system/nvidia/gpu0')).toBe('vram_used');
    expect(canonicalKey('cpu_util', 'system')).toBe('cpu_util');
  });
});

describe('displayMetricName', () => {
  it('renders device series as canonical path without system/ prefix', () => {
    expect(displayMetricName('util', 'system/nvidia/gpu0')).toBe('nvidia/gpu0/gpu_util');
    expect(displayMetricName('mem_used', 'system/nvidia/gpu0')).toBe('nvidia/gpu0/vram_used');
    expect(displayMetricName('vram_used', 'system/apple/gpu0')).toBe('apple/gpu0/vram_used');
    expect(displayMetricName('temperature', 'system/cpu')).toBe('cpu/temp_c');
  });

  it('renders host series as bare canonical key', () => {
    expect(displayMetricName('cpu', 'system')).toBe('cpu_util');
    expect(displayMetricName('cpu_util', 'system')).toBe('cpu_util');
    expect(displayMetricName('mem_used', 'system')).toBe('mem_used');
    expect(displayMetricName('mem_used_prop', 'system')).toBe('mem_util');
  });

  it('returns null for non-system metrics', () => {
    expect(displayMetricName('loss', 'train')).toBeNull();
    expect(displayMetricName('acc', '')).toBeNull();
  });

  it('generalizes to unknown system keys via path form', () => {
    // 标识符本位:任何 system 域 key 都按路径显示,无需映射表
    expect(displayMetricName('mem_total', 'system')).toBe('mem_total');
    expect(displayMetricName('anything', 'system/nvidia/gpu1')).toBe('nvidia/gpu1/anything');
  });
});

describe('formatSystemValue', () => {
  it('formats memory in GB from MiB', () => {
    expect(formatSystemValue('mem_used', 'system', 45162)).toBe('44.1 GB');
    expect(formatSystemValue('vram_used', 'system/nvidia/gpu0', 9403.63)).toBe('9.2 GB');
  });

  it('formats utilizations as percentages', () => {
    expect(formatSystemValue('gpu_util', 'system/nvidia/gpu0', 0.9)).toBe('90%');
    expect(formatSystemValue('mem_util', 'system', 0.085)).toBe('9%');
    expect(formatSystemValue('vram_util', 'system/nvidia/gpu0', 0.3333)).toBe('33%');
  });

  it('formats power and temperature', () => {
    expect(formatSystemValue('power_w', 'system/nvidia/gpu0', 319.8)).toBe('320 W');
    expect(formatSystemValue('temp_c', 'system/nvidia/gpu0', 85.2)).toBe('85°C');
  });
});

describe('systemAxisFormatter', () => {
  it('gives a formatter for system metrics', () => {
    const fmt = systemAxisFormatter('vram_used', 'system/nvidia/gpu0');
    expect(fmt?.(6134)).toBe('6.0 GB');
  });

  it('gives undefined for non-system metrics', () => {
    expect(systemAxisFormatter('loss', 'train')).toBeUndefined();
  });
});

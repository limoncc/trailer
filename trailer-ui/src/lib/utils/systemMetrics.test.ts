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
  it('renders device series with device label', () => {
    expect(displayMetricName('mem_used', 'system/nvidia/gpu0')).toBe('显存占用 · nvidia gpu0');
    expect(displayMetricName('util', 'system/nvidia/gpu0')).toBe('GPU 利用率 · nvidia gpu0');
    expect(displayMetricName('vram_used', 'system/apple/gpu0')).toBe('显存占用 · apple gpu0');
  });

  it('renders host series without device suffix', () => {
    expect(displayMetricName('mem_used', 'system')).toBe('主机内存');
    expect(displayMetricName('cpu', 'system')).toBe('CPU 利用率');
    expect(displayMetricName('cpu_util', 'system')).toBe('CPU 利用率');
  });

  it('renders cpu device metrics without redundant suffix', () => {
    expect(displayMetricName('temperature', 'system/cpu')).toBe('CPU 温度');
    expect(displayMetricName('power', 'system/cpu')).toBe('CPU 功耗');
  });

  it('returns null for non-system metrics', () => {
    expect(displayMetricName('loss', 'train')).toBeNull();
    expect(displayMetricName('acc', '')).toBeNull();
  });

  it('returns null for unknown system keys', () => {
    expect(displayMetricName('mem_total', 'system')).toBeNull();
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

import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('columnConfig', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it('loads defaults when no saved config', async () => {
    const { loadColumnConfig } = await import('./columnConfig');
    const cfg = loadColumnConfig('test-project');
    expect(cfg.visible).toContain('name');
    expect(cfg.visible).toContain('state');
    expect(cfg.order.length).toBe(3);
  });

  it('saves and reloads config', async () => {
    const { loadColumnConfig, saveColumnConfig } = await import('./columnConfig');
    const custom = { visible: ['name', 'state'], order: ['state', 'name'], widths: { name: 300, state: 150 } };
    saveColumnConfig('test-project', custom);
    const loaded = loadColumnConfig('test-project');
    expect(loaded.visible).toEqual(['name', 'state']);
    expect(loaded.order).toEqual(['state', 'name']);
    expect(loaded.widths.name).toBe(300);
  });

  it('returns defaults on corrupted data', async () => {
    localStorage.setItem('trailer-columns-test-project', 'invalid json{{{');
    const { loadColumnConfig } = await import('./columnConfig');
    const cfg = loadColumnConfig('test-project');
    expect(cfg.visible).toContain('name');
  });

  it('reset clears saved config', async () => {
    const { loadColumnConfig, saveColumnConfig, resetColumnConfig } = await import('./columnConfig');
    saveColumnConfig('test-project', { visible: ['name'], order: ['name'], widths: {} });
    resetColumnConfig('test-project');
    const cfg = loadColumnConfig('test-project');
    expect(cfg.visible).toContain('state');
  });
});

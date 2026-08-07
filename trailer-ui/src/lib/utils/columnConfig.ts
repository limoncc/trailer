/** Column configuration — visibility, order, and widths persisted in localStorage. */

const STORAGE_PREFIX = 'trailer-columns';

export interface ColumnConfig {
  visible: string[];
  order: string[];
  widths: Record<string, number>;
}

const DEFAULTS: ColumnConfig = {
  visible: ['name', 'state', 'created_at'],
  order: ['name', 'state', 'created_at'],
  widths: { name: 200, state: 100, created_at: 180 },
};

export function loadColumnConfig(key: string): ColumnConfig {
  try {
    const raw = localStorage.getItem(`${STORAGE_PREFIX}-${key}`);
    if (!raw) return { ...DEFAULTS };
    return JSON.parse(raw) as ColumnConfig;
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveColumnConfig(key: string, config: ColumnConfig): void {
  try {
    localStorage.setItem(`${STORAGE_PREFIX}-${key}`, JSON.stringify(config));
  } catch {
    // localStorage full or unavailable — silently fail
  }
}

export function resetColumnConfig(key: string): void {
  try {
    localStorage.removeItem(`${STORAGE_PREFIX}-${key}`);
  } catch {
    // ignore
  }
}

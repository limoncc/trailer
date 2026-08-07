/// Refresh interval in seconds (0 = off).
/// Shared via a simple subscription-based pattern.
/// Persisted to localStorage.

import { writable } from 'svelte/store';

const STORAGE_KEY = 'trailer-refresh-interval';

function load(): number {
  if (typeof localStorage === 'undefined') return 5;
  try {
    const v = parseInt(localStorage.getItem(STORAGE_KEY) || '5', 10);
    return isNaN(v) ? 5 : Math.max(0, v);
  } catch { return 5; }
}

export const refreshInterval = writable<number>(load());

// Persist to localStorage on every change
if (typeof localStorage !== 'undefined') {
  refreshInterval.subscribe(v => {
    try { localStorage.setItem(STORAGE_KEY, String(v)); } catch { /* ignore */ }
  });
}

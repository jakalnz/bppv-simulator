export type Theme = 'dark' | 'light';

const STORAGE_KEY = 'bppv-simulator-theme';

function systemPreference(): Theme {
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
}

/**
 * Reads any saved preference (localStorage), falling back to the OS/browser's own
 * prefers-color-scheme if the user has never explicitly chosen one here, and applies it
 * immediately. Returns the resolved theme so the toggle button can show the right icon
 * state from the start rather than flashing the wrong one.
 */
export function initTheme(): Theme {
  const saved = localStorage.getItem(STORAGE_KEY);
  const theme: Theme = saved === 'light' || saved === 'dark' ? saved : systemPreference();
  applyTheme(theme);
  return theme;
}

/** Flips the current theme, persists the explicit choice, and returns the new theme. */
export function toggleTheme(): Theme {
  const next: Theme = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
  applyTheme(next);
  localStorage.setItem(STORAGE_KEY, next);
  return next;
}

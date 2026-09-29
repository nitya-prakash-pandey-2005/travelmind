import { useSyncExternalStore } from "react";

export type Theme = "dark" | "daylight";

const STORAGE_KEY = "tm-theme";
const listeners = new Set<() => void>();
let current: Theme = "dark";

function readStored(): Theme | null {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return value === "dark" || value === "daylight" ? value : null;
  } catch {
    return null;
  }
}

function apply(theme: Theme): void {
  current = theme;
  document.documentElement.dataset.theme = theme;
}

/** Call once before first render so the saved theme paints without a flash. */
export function initTheme(): Theme {
  apply(readStored() ?? "dark");
  return current;
}

export function getTheme(): Theme {
  return current;
}

export function setTheme(theme: Theme): void {
  apply(theme);
  try {
    window.localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Storage blocked (private mode, quota): the theme still applies for this session.
  }
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useTheme(): [Theme, (theme: Theme) => void] {
  const theme = useSyncExternalStore(subscribe, getTheme, getTheme);
  return [theme, setTheme];
}

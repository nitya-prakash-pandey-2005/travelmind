import { useSyncExternalStore } from "react";
import { applyTheme } from "./applyTheme";
import { coerceChoice, themeMeta } from "./palettes";
import { DEFAULT_CHOICE, parseChoice, readChoice, STORAGE_KEY, writeChoice } from "./storage";
import type { ThemeChoice } from "./types";

/**
 * The theme choice lives outside React so the pre-render init, every hook and other tabs share one value.
 * `preferred` is what the viewer picked (kept, so leaving a fixed theme restores their own mode and contrast);
 * `current` is the coerced look that is on screen.
 */
let preferred: ThemeChoice = DEFAULT_CHOICE;
let current: ThemeChoice = coerceChoice(DEFAULT_CHOICE);
const listeners = new Set<() => void>();

function commit(next: ThemeChoice): void {
  preferred = next;
  const look = coerceChoice(next);
  const changed = look.theme !== current.theme || look.mode !== current.mode || look.contrast !== current.contrast;
  if (changed) current = look;
  applyTheme(current);
  if (changed) listeners.forEach((listener) => listener());
}

/** Read the saved choice and apply it. main.tsx calls this before the first render. */
export function initTheme(): ThemeChoice {
  commit(readChoice());
  return current;
}

export function getThemeChoice(): ThemeChoice {
  return current;
}

/**
 * Change the theme, mode or contrast; applies instantly and persists. While a fixed theme is showing, mode and
 * contrast changes are ignored (the switcher disables them too).
 */
export function setThemeChoice(patch: Partial<ThemeChoice>): void {
  const switchingTheme = patch.theme !== undefined && patch.theme !== current.theme;
  if (!switchingTheme && themeMeta(current.theme).modes !== "toggle") return;
  const next: ThemeChoice = {
    theme: patch.theme ?? preferred.theme,
    mode: patch.mode ?? preferred.mode,
    contrast: patch.contrast ?? preferred.contrast,
  };
  commit(next);
  writeChoice(next);
}

/** Pick up a choice saved in another tab (storage events only fire in the other tabs). */
export function syncFromStorage(event: StorageEvent): void {
  if (event.key !== STORAGE_KEY) return;
  commit(parseChoice(event.newValue) ?? DEFAULT_CHOICE);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The look on screen and a setter taking any part of a choice: `setChoice({ theme: "nebula" })`. */
export function useThemeChoice(): [ThemeChoice, (patch: Partial<ThemeChoice>) => void] {
  const choice = useSyncExternalStore(subscribe, getThemeChoice, getThemeChoice);
  return [choice, setThemeChoice];
}

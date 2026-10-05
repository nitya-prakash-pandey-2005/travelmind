import { RETIRED_THEMES, THEME_IDS } from "./palettes";
import type { ThemeChoice, ThemeId } from "./types";

export const STORAGE_KEY = "tm.theme";
/** The v2 key, holding "dark" or "daylight". Read once, migrated to STORAGE_KEY, then removed. */
export const LEGACY_STORAGE_KEY = "tm-theme";

export const DEFAULT_CHOICE: ThemeChoice = Object.freeze({ theme: "aurora", mode: "dark", contrast: false });

/**
 * A stored value as a choice, or null when it isn't one. Bad mode/contrast fields fall back to dark/normal, and a
 * retired theme (Orbital, Nebula, Terminal) moves to its replacement (see RETIRED_THEMES).
 */
export function parseChoice(raw: string | null): ThemeChoice | null {
  if (!raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const { theme, mode, contrast } = value as Record<string, unknown>;
  const retired = typeof theme === "string" && Object.hasOwn(RETIRED_THEMES, theme) ? RETIRED_THEMES[theme] : undefined;
  if (retired) {
    return { theme: retired.theme, mode: retired.mode ?? (mode === "light" ? "light" : "dark"), contrast: contrast === true };
  }
  if (!THEME_IDS.includes(theme as ThemeId)) return null;
  return { theme: theme as ThemeId, mode: mode === "light" ? "light" : "dark", contrast: contrast === true };
}

/** True when a stored value names a retired theme (so the migrated choice is written back once). */
function isRetired(raw: string): boolean {
  try {
    const theme: unknown = (JSON.parse(raw) as Record<string, unknown> | null)?.theme;
    return typeof theme === "string" && Object.hasOwn(RETIRED_THEMES, theme);
  } catch {
    return false;
  }
}

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** The saved choice (as picked, before fixed-theme coercion), migrating the v2 value; the default when none. */
export function readChoice(): ThemeChoice {
  const store = storage();
  let saved: string | null;
  let legacy: string | null;
  try {
    saved = store?.getItem(STORAGE_KEY) ?? null;
    legacy = store?.getItem(LEGACY_STORAGE_KEY) ?? null;
  } catch {
    // Blocked or broken storage (private mode, site-data policy): use the default for this visit.
    return DEFAULT_CHOICE;
  }
  let choice = parseChoice(saved);
  if (choice && saved && isRetired(saved)) writeChoice(choice);
  if (!choice && (legacy === "dark" || legacy === "daylight")) {
    choice = { theme: DEFAULT_CHOICE.theme, mode: legacy === "daylight" ? "light" : "dark", contrast: false };
    writeChoice(choice);
  }
  if (legacy !== null) {
    try {
      store?.removeItem(LEGACY_STORAGE_KEY);
    } catch {
      // Leaving the old key behind is harmless: a saved new-style choice always wins.
    }
  }
  return choice ?? DEFAULT_CHOICE;
}

export function writeChoice(choice: ThemeChoice): void {
  try {
    storage()?.setItem(STORAGE_KEY, JSON.stringify({ theme: choice.theme, mode: choice.mode, contrast: choice.contrast }));
  } catch {
    // Storage blocked: the theme still applies for this session.
  }
}

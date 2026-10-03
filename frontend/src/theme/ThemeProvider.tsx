import { useEffect, type ReactNode } from "react";
import { syncFromStorage } from "./store";

/**
 * Keeps the theme in step with other tabs. The saved choice is applied once, before the first render, by
 * `initTheme()` in main.tsx (and before that by the pre-paint script), so mounting or remounting the provider
 * never resets a choice made since. The choice lives in a shared store, so `useThemeChoice()` and
 * `useThemePalette()` also work outside the provider (tests, isolated widgets).
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    window.addEventListener("storage", syncFromStorage);
    return () => window.removeEventListener("storage", syncFromStorage);
  }, []);
  return <>{children}</>;
}

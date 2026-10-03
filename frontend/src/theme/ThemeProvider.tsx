import { useEffect, type ReactNode } from "react";
import { initTheme, syncFromStorage } from "./store";

/**
 * Applies the saved theme to <html> when the app mounts and follows changes made in other tabs. The choice
 * itself lives in a shared store, so `useThemeChoice()` and `useThemePalette()` also work outside the provider
 * (tests, isolated widgets); the provider is what keeps <html> in step with storage.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    initTheme();
    window.addEventListener("storage", syncFromStorage);
    return () => window.removeEventListener("storage", syncFromStorage);
  }, []);
  return <>{children}</>;
}

import { resolvePalette } from "./palettes";
import { useThemeChoice } from "./store";
import type { Palette } from "./types";

/**
 * The live palette as plain values, for code that can't read CSS variables: canvas, WebGL (the globe) and
 * computed colours. Re-renders on every theme switch; the object is stable for a given look, so it is safe
 * as a memo or effect dependency.
 */
export function useThemePalette(): Palette {
  const [choice] = useThemeChoice();
  return resolvePalette(choice);
}

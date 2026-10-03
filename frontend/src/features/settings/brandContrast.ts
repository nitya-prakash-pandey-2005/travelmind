import { BRAND_COLOR } from "../../api/agency";
import { contrastRatio, DEFAULT_CHOICE, resolvePalette, type Palette, type ThemeMode } from "../../theme";

/**
 * The brand colour marks buttons, the header rule and the selection on the client's quote page, so as a
 * non-text accent (WCAG 1.4.11) it needs 3:1 against the page and the cards. It is checked against the
 * default theme in both modes: what a client sees unless they pick another look.
 */
export const MIN_ACCENT_CONTRAST = 3;

export type BrandCheck = {
  mode: ThemeMode;
  palette: Palette;
  /** Against the page background and against the cards; `ratio` is the weaker of the two. */
  page: number;
  card: number;
  ratio: number;
  passes: boolean;
};

const MODES: readonly ThemeMode[] = ["dark", "light"];

export function isBrandColor(value: string): boolean {
  return BRAND_COLOR.test(value);
}

/** What the hex field holds once typed: trimmed, lower case, with the leading # added if it was left off. */
export function normaliseBrandInput(raw: string): string {
  const value = raw.trim().toLowerCase();
  if (value === "") return "";
  return value.startsWith("#") ? value : `#${value}`;
}

export function themePalette(mode: ThemeMode): Palette {
  return resolvePalette({ theme: DEFAULT_CHOICE.theme, mode, contrast: false });
}

/** The dark and light checks for a valid colour; none for anything else. */
export function brandChecks(color: string): BrandCheck[] {
  if (!isBrandColor(color)) return [];
  return MODES.map((mode) => {
    const palette = themePalette(mode);
    const page = contrastRatio(color, palette.bg);
    const card = contrastRatio(color, palette.surface);
    const ratio = Math.min(page, card);
    return { mode, palette, page, card, ratio, passes: ratio >= MIN_ACCENT_CONTRAST };
  });
}

/** Text on an accent fill: the theme's text or background colour, whichever reads better on it. */
export function brandInk(color: string, palette: Palette): string {
  return contrastRatio(palette.ink, color) >= contrastRatio(palette.bg, color) ? palette.ink : palette.bg;
}

/** "4.6:1", rounded down so a ratio just under a threshold never reads as meeting it. */
export function formatRatio(ratio: number): string {
  return `${(Math.floor(ratio * 10) / 10).toFixed(1)}:1`;
}

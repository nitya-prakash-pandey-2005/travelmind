import { BRAND_COLOR } from "../../api/agency";
import { contrastRatio, DEFAULT_CHOICE, resolvePalette, type Palette, type ThemeMode } from "../../theme";
import { brandAccent, type BrandAccent } from "../publicQuote/brandAccent";

/**
 * The brand colour marks buttons, the header rule and the selection on the client's quote page. That page uses
 * it only when `brandAccent` accepts it: 3:1 against the page and the cards (non-text contrast, WCAG 1.4.11)
 * and a theme text colour reaching 4.5:1 on it, for the button labels; otherwise the theme's own accent stands
 * in. Settings applies the very same rule, against the default theme in both modes: what a client sees unless
 * they pick another look.
 */
export const MIN_ACCENT_CONTRAST = 3;
export const MIN_TEXT_CONTRAST = 4.5;

/** Why the client page wouldn't use the colour: too close to the page or cards, or no readable text on it. */
export type BrandProblem = "faint" | "text";

export type BrandCheck = {
  mode: ThemeMode;
  palette: Palette;
  /** Against the page background and against the cards; `ratio` is the weaker of the two. */
  page: number;
  card: number;
  ratio: number;
  /** The best contrast a theme text colour reaches on the colour (for button labels). */
  text: number;
  /** What the client page shows in this mode: the brand colour, or the theme's accent in its place. */
  accent: BrandAccent;
  /** True when the client page uses the brand colour (`accent.fromBrand`). */
  passes: boolean;
  problem: BrandProblem | null;
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
    const text = Math.max(contrastRatio(palette.ink, color), contrastRatio(palette.bg, color));
    const accent = brandAccent(color, palette);
    const passes = accent.fromBrand;
    const problem: BrandProblem | null = passes ? null : ratio < MIN_ACCENT_CONTRAST ? "faint" : "text";
    return { mode, palette, page, card, ratio, text, accent, passes, problem };
  });
}

/** "4.6:1", rounded down so a ratio just under a threshold never reads as meeting it. */
export function formatRatio(ratio: number): string {
  return `${(Math.floor(ratio * 10) / 10).toFixed(1)}:1`;
}

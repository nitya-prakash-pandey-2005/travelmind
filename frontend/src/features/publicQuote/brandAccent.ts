import { compositeOver, contrastRatio, resolvePalette, TOKEN_VARS, type Palette, type PaletteToken } from "../../theme";

/** The colours the client's page uses for the agency's accent: buttons, the header rule, the mark. */
export type BrandAccent = {
  accent: string;
  /** Text on an accent fill (at least 4.5:1). */
  accentInk: string;
  /** The fill on hover, a step further from `accentInk`. */
  accentHover: string;
  /** False when the theme's primary stands in for the agency's colour. */
  fromBrand: boolean;
};

const HEX = /^#[0-9a-f]{6}$/i;
/** Non-text contrast (WCAG 1.4.11) against the page and the cards: the accent marks controls and the selection. */
const MIN_UI_CONTRAST = 3;
const MIN_TEXT_CONTRAST = 4.5;

/**
 * The agency's brand colour when it reads on this theme (3:1 against the page and the cards, and a theme text
 * colour reaches 4.5:1 on it); otherwise the theme's own primary, which the theme tests already hold to AA.
 */
export function brandAccent(brand: string, palette: Palette): BrandAccent {
  const fallback: BrandAccent = {
    accent: palette.primary,
    accentInk: palette.primaryInk,
    accentHover: palette.primaryHover,
    fromBrand: false,
  };
  if (!HEX.test(brand)) return fallback;
  if (contrastRatio(brand, palette.bg) < MIN_UI_CONTRAST || contrastRatio(brand, palette.surface) < MIN_UI_CONTRAST) {
    return fallback;
  }
  const [ink, away] =
    contrastRatio(palette.ink, brand) >= contrastRatio(palette.bg, brand)
      ? [palette.ink, palette.bg]
      : [palette.bg, palette.ink];
  if (contrastRatio(ink, brand) < MIN_TEXT_CONTRAST) return fallback;
  return { accent: brand, accentInk: ink, accentHover: compositeOver(brand, away, 0.86), fromBrand: true };
}

/** Paper is always light, whatever the screen theme. */
export function printPalette(): Palette {
  return resolvePalette({ theme: "clearsky", mode: "light", contrast: false });
}

/** The accent as custom properties for the page root (`--pq-accent*`, and `--tm-brand` for the agency mark). */
export function accentVars(accent: BrandAccent): Record<string, string> {
  return {
    "--pq-accent": accent.accent,
    "--pq-accent-ink": accent.accentInk,
    "--pq-accent-hover": accent.accentHover,
    "--tm-brand": accent.accent,
  };
}

/**
 * The print sheet: every theme token from the light palette (and the accent checked against it) on the page root,
 * so a dark screen theme still prints dark text on white paper; the Terminal overlays are dropped.
 */
export function printCss(scope: string, brand: string): string {
  const palette = printPalette();
  const tokens = (Object.keys(TOKEN_VARS) as PaletteToken[]).map((token) => `${TOKEN_VARS[token]}: ${palette[token]};`);
  const accent = Object.entries(accentVars(brandAccent(brand, palette))).map(([name, value]) => `${name}: ${value};`);
  return [
    "@media print {",
    `  ${scope} { ${[...tokens, ...accent].join(" ")} color-scheme: light; }`,
    "  body::before, body::after { display: none !important; }",
    "  @page { margin: 14mm 12mm; }",
    "}",
  ].join("\n");
}

/**
 * The six themes as data: the only place (with theme.css fallbacks) where colour values live.
 *
 * Each look is resolved from a small core (surfaces, text, accents, chart hues) plus rules shared by every
 * theme (status hues per dark/light, translucent fills, shadow, glow). `src/styles/themes.generated.css` is
 * built from this file (`npm run theme:css`) and the contrast tests check every look against WCAG AA.
 */
import type { Palette, PaletteToken, ThemeChoice, ThemeId, ThemeMeta, ThemeMode } from "./types";

export const THEMES: readonly ThemeMeta[] = [
  { id: "orbital", name: "Orbital", tagline: "Graphite console, cyan telemetry", swatch: ["#0A0C10", "#151920", "#3CC6F0", "#F0B429"], modes: "toggle" },
  { id: "nebula", name: "Nebula", tagline: "Violet night with teal and violet glow", swatch: ["#070619", "#1A1540", "#8EF3FF", "#C9A7FF"], modes: "toggle" },
  { id: "ember", name: "Ember", tagline: "Deep indigo with saffron and amber warmth", swatch: ["#080B1C", "#151B3D", "#FF9933", "#3FB950"], modes: "toggle" },
  { id: "clearsky", name: "Clearsky", tagline: "Bright and clean, for projectors and daylight", swatch: ["#FFFFFF", "#EDF1F6", "#0B57D0", "#7A3E00"], modes: "fixed-light" },
  { id: "terminal", name: "Terminal", tagline: "Amber monochrome console, all monospace", swatch: ["#0A0700", "#181104", "#FFB000", "#FF8C1A"], modes: "fixed-dark" },
  { id: "contrast", name: "Contrast", tagline: "Black, white and yellow; maximum legibility", swatch: ["#000000", "#111111", "#FFFFFF", "#FFE600"], modes: "fixed-dark" },
];

export const THEME_IDS: readonly ThemeId[] = THEMES.map((theme) => theme.id);

export function themeMeta(id: ThemeId): ThemeMeta {
  return THEMES.find((theme) => theme.id === id) ?? (THEMES[0] as ThemeMeta);
}

/** The look a choice actually gets: fixed themes force their own mode and switch the contrast flag off. */
export function coerceChoice(choice: ThemeChoice): ThemeChoice {
  const { modes } = themeMeta(choice.theme);
  if (modes === "toggle") return choice;
  return { theme: choice.theme, mode: modes === "fixed-light" ? "light" : "dark", contrast: false };
}

/** Every distinct look (already coerced): 3 toggle themes x dark/light x normal/high contrast, then the fixed ones. */
export const ALL_CHOICES: readonly ThemeChoice[] = THEMES.flatMap((theme): ThemeChoice[] =>
  theme.modes === "toggle"
    ? (["dark", "light"] as const).flatMap((mode) => [false, true].map((contrast) => ({ theme: theme.id, mode, contrast })))
    : [coerceChoice({ theme: theme.id, mode: "dark", contrast: false })],
);

/** Custom property each token is written to. The older names (`--tm-border`, `--tm-text-2` ...) are kept on purpose. */
export const TOKEN_VARS: Readonly<Record<PaletteToken, string>> = {
  bg: "--tm-bg",
  surface: "--tm-surface",
  surface2: "--tm-surface-2",
  line: "--tm-border",
  lineStrong: "--tm-border-strong",
  ink: "--tm-text",
  dim: "--tm-text-2",
  faint: "--tm-text-3",
  primary: "--tm-primary",
  primaryInk: "--tm-primary-ink",
  accent2: "--tm-accent-2",
  ok: "--tm-ok",
  warn: "--tm-warn",
  danger: "--tm-danger",
  info: "--tm-info",
  ai: "--tm-ai",
  chart1: "--tm-chart-1",
  chart2: "--tm-chart-2",
  chart3: "--tm-chart-3",
  chart4: "--tm-chart-4",
  chart5: "--tm-chart-5",
  chart6: "--tm-chart-6",
  chartGrid: "--tm-chart-grid",
  chartAxis: "--tm-chart-axis",
  globeLand: "--tm-globe-land",
  globeOcean: "--tm-globe-ocean",
  glow: "--tm-glow",
  shadow: "--tm-shadow-pop",
  backdrop: "--tm-backdrop",
  hover: "--tm-hover",
  selected: "--tm-selected",
  skeleton: "--tm-skeleton",
  dot: "--tm-dot",
  tintFill: "--tm-tint-fill",
  tintEdge: "--tm-tint-edge",
  radiusControl: "--tm-radius-control",
  radiusPanel: "--tm-radius-panel",
  fontSans: "--tm-font-sans",
  fontDisplay: "--tm-font-display",
  fontMono: "--tm-font-mono",
};

// ---- Building blocks -----------------------------------------------------------------------------

/** Colours a theme picks for one mode. Everything else in a Palette is derived from these. */
type Core = Pick<
  Palette,
  | "bg" | "surface" | "surface2" | "line" | "lineStrong" | "ink" | "dim" | "faint" | "primary" | "primaryInk"
  | "accent2" | "ai" | "chart1" | "chart2" | "chart3" | "chart4" | "chart5" | "chart6" | "globeLand" | "globeOcean"
>;

type Look = {
  fonts: Pick<Palette, "fontSans" | "fontDisplay" | "fontMono">;
  radius: Pick<Palette, "radiusControl" | "radiusPanel">;
  /** Page titles carry a soft accent glow in dark mode. */
  glow: boolean;
  /** Ambient texture (the dot grid). Off for themes that want a plain page. */
  ambient: boolean;
};

const SANS_FALLBACK = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';
const MONO_FALLBACK = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
const INTER = `"Inter Variable", "Inter", ${SANS_FALLBACK}`;
const SORA = `"Sora Variable", "Sora", ${SANS_FALLBACK}`;
const FRAUNCES = '"Fraunces", ui-serif, Georgia, "Times New Roman", serif';
const JETBRAINS = `"JetBrains Mono", ${MONO_FALLBACK}`;
const PLEX = `"IBM Plex Mono", ${MONO_FALLBACK}`;

const STANDARD_RADIUS = { radiusControl: "6px", radiusPanel: "8px" };

const LOOKS: Record<ThemeId, Look> = {
  orbital: { fonts: { fontSans: INTER, fontDisplay: INTER, fontMono: JETBRAINS }, radius: STANDARD_RADIUS, glow: true, ambient: true },
  nebula: { fonts: { fontSans: SORA, fontDisplay: SORA, fontMono: JETBRAINS }, radius: STANDARD_RADIUS, glow: true, ambient: true },
  ember: { fonts: { fontSans: INTER, fontDisplay: FRAUNCES, fontMono: PLEX }, radius: STANDARD_RADIUS, glow: false, ambient: true },
  clearsky: { fonts: { fontSans: INTER, fontDisplay: INTER, fontMono: PLEX }, radius: { radiusControl: "8px", radiusPanel: "12px" }, glow: false, ambient: false },
  terminal: { fonts: { fontSans: PLEX, fontDisplay: PLEX, fontMono: PLEX }, radius: { radiusControl: "0px", radiusPanel: "0px" }, glow: false, ambient: true },
  contrast: { fonts: { fontSans: INTER, fontDisplay: INTER, fontMono: PLEX }, radius: STANDARD_RADIUS, glow: false, ambient: false },
};

/** Status hues are fixed per mode so "ok/warn/danger/info" read the same in every theme. */
const STATUS: Record<ThemeMode, Pick<Palette, "ok" | "warn" | "danger" | "info">> = {
  dark: { ok: "#3FB950", warn: "#FFD166", danger: "#FF6B6B", info: "#6FA8FF" },
  light: { ok: "#0F6B0F", warn: "#7E5300", danger: "#B3261E", info: "#1F4FB8" },
};

/** Core colours per toggle theme and mode. Values from the v3 spec; unspecified ones derived and AA-checked. */
const CORES: Record<"orbital" | "nebula" | "ember", Record<ThemeMode, Core>> = {
  orbital: {
    dark: {
      bg: "#0A0C10", surface: "#0F1217", surface2: "#151920", line: "#222833", lineStrong: "#2E3542",
      ink: "#E7EAF0", dim: "#9AA3B2", faint: "#7A8294", primary: "#3CC6F0", primaryInk: "#04121A", accent2: "#F0B429", ai: "#9B8AFB",
      chart1: "#3CC6F0", chart2: "#9B8AFB", chart3: "#F0B429", chart4: "#34C38F", chart5: "#F0555A", chart6: "#6A9CFF",
      globeLand: "#2A3342", globeOcean: "#0C0F14",
    },
    light: {
      bg: "#F6F7F9", surface: "#FFFFFF", surface2: "#F1F3F6", line: "#E3E6EB", lineStrong: "#CDD2DA",
      ink: "#0E131B", dim: "#4B5566", faint: "#666F81", primary: "#0875AF", primaryInk: "#FFFFFF", accent2: "#8A5A00", ai: "#6D4AE0",
      chart1: "#0B84C6", chart2: "#6D4AE0", chart3: "#B45309", chart4: "#15803D", chart5: "#C81E1E", chart6: "#2F5FD0",
      globeLand: "#C9D0DA", globeOcean: "#EEF1F5",
    },
  },
  nebula: {
    dark: {
      bg: "#070619", surface: "#120F2E", surface2: "#1A1540", line: "#3A3470", lineStrong: "#4D4690",
      ink: "#EEF0FF", dim: "#A5A3CF", faint: "#8C8AB8", primary: "#8EF3FF", primaryInk: "#071A1F", accent2: "#C9A7FF", ai: "#C9A7FF",
      chart1: "#8EF3FF", chart2: "#C9A7FF", chart3: "#FFD166", chart4: "#3FB950", chart5: "#FF8FB1", chart6: "#6FA8FF",
      globeLand: "#2A2560", globeOcean: "#0B0A22",
    },
    light: {
      bg: "#F4F2FB", surface: "#FFFFFF", surface2: "#ECE9F7", line: "#DAD5EE", lineStrong: "#C3BCE0",
      ink: "#1B1640", dim: "#4A4570", faint: "#625D88", primary: "#0B6F84", primaryInk: "#FFFFFF", accent2: "#6B3FC9", ai: "#6B3FC9",
      chart1: "#0B6F84", chart2: "#6B3FC9", chart3: "#9A5B00", chart4: "#0F6B0F", chart5: "#B3261E", chart6: "#1F4FB8",
      globeLand: "#CFC9E6", globeOcean: "#ECE9F7",
    },
  },
  ember: {
    dark: {
      bg: "#080B1C", surface: "#0F1430", surface2: "#151B3D", line: "#2E3870", lineStrong: "#3D4886",
      ink: "#F4F1E8", dim: "#AFAAC0", faint: "#8F8BA6", primary: "#FF9933", primaryInk: "#1A0D00", accent2: "#3FB950", ai: "#B8A6FF",
      chart1: "#FF9933", chart2: "#3FB950", chart3: "#8FB8FF", chart4: "#FFD166", chart5: "#FF6B6B", chart6: "#C9A7FF",
      globeLand: "#26306A", globeOcean: "#0B1026",
    },
    light: {
      bg: "#F7F9FC", surface: "#FFFFFF", surface2: "#EEF2F8", line: "#DCE2EC", lineStrong: "#C4CDDB",
      ink: "#14213D", dim: "#46526B", faint: "#5E6982", primary: "#A65200", primaryInk: "#FFFFFF", accent2: "#0F6B0F", ai: "#5B3FC4",
      chart1: "#A65200", chart2: "#0F6B0F", chart3: "#1F4FB8", chart4: "#B3261E", chart5: "#6B3FC9", chart6: "#0B6F84",
      globeLand: "#CBD3E1", globeOcean: "#EEF2F8",
    },
  },
};

const FIXED_CORES: Record<"clearsky" | "terminal" | "contrast", Core> = {
  clearsky: {
    bg: "#FFFFFF", surface: "#F6F8FB", surface2: "#EDF1F6", line: "#C3CCD8", lineStrong: "#94A3B8",
    ink: "#0B1220", dim: "#334155", faint: "#4B5768", primary: "#0B57D0", primaryInk: "#FFFFFF", accent2: "#7A3E00", ai: "#5B2FC0",
    chart1: "#0B57D0", chart2: "#7A3E00", chart3: "#0F6B0F", chart4: "#B3261E", chart5: "#5B2FC0", chart6: "#0B6F84",
    globeLand: "#C3CCD8", globeOcean: "#EDF1F6",
  },
  terminal: {
    bg: "#0A0700", surface: "#110C02", surface2: "#181104", line: "#5C400C", lineStrong: "#7A5612",
    ink: "#FFB000", dim: "#E09A12", faint: "#B98410", primary: "#FFD27A", primaryInk: "#1A1000", accent2: "#FF8C1A", ai: "#FFE0A3",
    chart1: "#FFB000", chart2: "#FFD27A", chart3: "#FF8C1A", chart4: "#3FB950", chart5: "#FF6B6B", chart6: "#6FA8FF",
    globeLand: "#3A2A08", globeOcean: "#0E0A01",
  },
  contrast: {
    bg: "#000000", surface: "#000000", surface2: "#111111", line: "#FFFFFF", lineStrong: "#FFFFFF",
    ink: "#FFFFFF", dim: "#F0F0F0", faint: "#D6D6D6", primary: "#FFE600", primaryInk: "#000000", accent2: "#66E0FF", ai: "#D7B8FF",
    chart1: "#FFE600", chart2: "#66E0FF", chart3: "#FF8FB1", chart4: "#7CFC7C", chart5: "#FF9A3C", chart6: "#D7B8FF",
    globeLand: "#3A3A3A", globeOcean: "#000000",
  },
};

/** High-contrast neutrals laid over a toggle theme; its accents stay (darkened where AA needs it). */
const HIGH_CONTRAST: Record<ThemeMode, Partial<Core>> = {
  dark: {
    bg: "#000000", surface: "#060606", surface2: "#101010", line: "#BDBDBD", lineStrong: "#E0E0E0",
    ink: "#FFFFFF", dim: "#E8E8E8", faint: "#CFCFCF", globeLand: "#3A3A3A", globeOcean: "#050505",
  },
  light: {
    bg: "#FFFFFF", surface: "#FFFFFF", surface2: "#F0F0F0", line: "#3A3A3A", lineStrong: "#1A1A1A",
    ink: "#000000", dim: "#1C1C1C", faint: "#333333", globeLand: "#BDBDBD", globeOcean: "#F0F0F0",
  },
};

/** Orbital's light primary is 4.4:1 on the high-contrast #F0F0F0 surface; one step darker clears AA. */
const HIGH_CONTRAST_ACCENTS: Partial<Record<ThemeId, Partial<Record<ThemeMode, Partial<Core>>>>> = {
  orbital: { light: { primary: "#066A9E" } },
};

/** `#RRGGBB` at an alpha, as a CSS colour. */
function alpha(hex: string, amount: number): string {
  const value = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((at) => Number.parseInt(value.slice(at, at + 2), 16));
  return `rgb(${r} ${g} ${b} / ${amount})`;
}

function build(core: Core, look: Look, mode: ThemeMode, flat: boolean): Palette {
  const dark = mode === "dark";
  return {
    ...core,
    ...STATUS[mode],
    chartGrid: alpha(core.dim, 0.12),
    chartAxis: core.dim,
    glow: look.glow && dark && !flat ? alpha(core.primary, 0.35) : "transparent",
    shadow: flat
      ? "none"
      : dark
        ? "0 8px 24px -8px rgb(0 0 0 / 0.5), 0 0 0 1px rgb(0 0 0 / 0.2)"
        : `0 8px 24px -10px ${alpha(core.ink, 0.18)}, 0 0 0 1px ${alpha(core.ink, 0.04)}`,
    backdrop: dark ? alpha(core.bg, flat ? 0.88 : 0.66) : alpha(core.ink, flat ? 0.6 : 0.32),
    hover: alpha(core.ink, flat ? 0.1 : dark ? 0.04 : 0.035),
    selected: alpha(core.primary, flat ? 0.18 : dark ? 0.1 : 0.08),
    skeleton: alpha(core.dim, dark ? 0.1 : 0.09),
    dot: look.ambient && !flat ? alpha(core.ink, dark ? 0.07 : 0.08) : "transparent",
    tintFill: flat ? "0%" : dark ? "12%" : "7%",
    tintEdge: flat ? "100%" : dark ? "32%" : "28%",
    ...look.radius,
    ...look.fonts,
  };
}

function compute(choice: ThemeChoice): Palette {
  const { theme, mode, contrast } = choice;
  const look = LOOKS[theme];
  if (theme === "clearsky" || theme === "terminal" || theme === "contrast") {
    return build(FIXED_CORES[theme], look, mode, theme === "contrast");
  }
  const base = CORES[theme][mode];
  if (!contrast) return build(base, look, mode, false);
  return build({ ...base, ...HIGH_CONTRAST[mode], ...HIGH_CONTRAST_ACCENTS[theme]?.[mode] }, look, mode, true);
}

const cache = new Map<string, Palette>();

/** All tokens for a choice. Fixed themes resolve to their one look; results are cached (stable identity). */
export function resolvePalette(choice: ThemeChoice): Palette {
  const look = coerceChoice(choice);
  const key = `${look.theme}:${look.mode}:${look.contrast ? "high" : "normal"}`;
  let palette = cache.get(key);
  if (!palette) {
    palette = Object.freeze(compute(look));
    cache.set(key, palette);
  }
  return palette;
}

/**
 * The six themes as data: the only place (with theme.css fallbacks) where colour values live.
 *
 * Aurora (the default), Ocean, Ember and Forest come from the UI kit (D:\Hackathons\ui-kit, styles/tokens.css):
 * deep glass surfaces, one three-stop accent gradient and soft ambient glows. Each has a dark look (the kit's own)
 * and a derived light look, both with a high-contrast variant. Clearsky (light) and Contrast (black, white and
 * yellow) stay for accessibility.
 *
 * Each look is resolved from a small core (surfaces, text, accents, chart hues, gradient stops) plus rules shared by
 * every theme (status hues per dark/light, translucent fills, shadow, glow, ambience). `src/styles/themes.generated.css`
 * is built from this file (`npm run theme:css`) and the contrast tests check every look against WCAG AA.
 */
import { compositeOver } from "./contrast";
import type { Palette, PaletteToken, ThemeChoice, ThemeId, ThemeMeta, ThemeMode } from "./types";

type ThemeInfo = Omit<ThemeMeta, "swatch">;

/** Switcher order. Swatches are derived from each theme's resolved palette (see THEMES at the end of this file). */
const THEME_INFO: readonly ThemeInfo[] = [
  { id: "aurora", name: "Aurora", tagline: "Night glass with pink, violet and cyan glow", modes: "toggle" },
  { id: "ocean", name: "Ocean", tagline: "Midnight blue glass with sky and teal light", modes: "toggle" },
  { id: "ember", name: "Ember", tagline: "Warm dark glass with orange, rose and gold", modes: "toggle" },
  { id: "forest", name: "Forest", tagline: "Deep green glass with emerald and lime", modes: "toggle" },
  { id: "clearsky", name: "Clearsky", tagline: "Bright and clean, for projectors and daylight", modes: "fixed-light" },
  { id: "contrast", name: "Contrast", tagline: "Black, white and yellow; maximum legibility", modes: "fixed-dark" },
];

export const THEME_IDS: readonly ThemeId[] = THEME_INFO.map((theme) => theme.id);

/**
 * Retired theme ids and where a saved choice of theirs goes now. Terminal only ever had a dark look, so it lands
 * on Forest dark whatever mode was stored with it. The pre-paint script (css.ts) applies the same map.
 */
export const RETIRED_THEMES: Readonly<Record<string, { theme: ThemeId; mode?: ThemeMode }>> = {
  orbital: { theme: "aurora" },
  nebula: { theme: "aurora" },
  terminal: { theme: "forest", mode: "dark" },
};

function themeInfo(id: ThemeId): ThemeInfo {
  return THEME_INFO.find((theme) => theme.id === id) ?? (THEME_INFO[0] as ThemeInfo);
}

/** The look a choice actually gets: fixed themes force their own mode and switch the contrast flag off. */
export function coerceChoice(choice: ThemeChoice): ThemeChoice {
  const { modes } = themeInfo(choice.theme);
  if (modes === "toggle") return choice;
  return { theme: choice.theme, mode: modes === "fixed-light" ? "light" : "dark", contrast: false };
}

/** Every distinct look (already coerced): 4 toggle themes x dark/light x normal/high contrast, then the fixed ones. */
export const ALL_CHOICES: readonly ThemeChoice[] = THEME_INFO.flatMap((theme): ThemeChoice[] =>
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
  primaryHover: "--tm-primary-hover",
  primaryActive: "--tm-primary-active",
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
  shadowFrame: "--tm-shadow-frame",
  shadowRaise: "--tm-shadow-raise",
  backdrop: "--tm-backdrop",
  hover: "--tm-hover",
  selected: "--tm-selected",
  skeleton: "--tm-skeleton",
  dot: "--tm-dot",
  tintFill: "--tm-tint-fill",
  tintEdge: "--tm-tint-edge",
  card: "--tm-card",
  card2: "--tm-card-2",
  chrome: "--tm-chrome",
  lineSoft: "--tm-border-soft",
  grad1: "--tm-grad-1",
  grad2: "--tm-grad-2",
  grad3: "--tm-grad-3",
  grad: "--tm-grad",
  gradSoft: "--tm-grad-soft",
  ambient1: "--tm-ambient-1",
  ambient2: "--tm-ambient-2",
  ambient3: "--tm-ambient-3",
  hudGrid: "--tm-hud-grid",
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
  | "grad1" | "grad2" | "grad3"
>;

type Look = {
  /** Kit themes carry the kit's status hues (green, amber, rose, cyan); the accessibility looks keep their own. */
  kitStatus: boolean;
  /** Soft accent glow (logo, primary buttons) in dark mode. */
  glow: boolean;
  /** Ambient page glows and the HUD grid. Off for themes that want a plain page. */
  ambient: boolean;
};

const SANS_FALLBACK = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';
const MONO_FALLBACK = 'ui-monospace, "Cascadia Code", SFMono-Regular, Menlo, Consolas, monospace';
/** The kit's three faces: Space Grotesk for titles and big numbers, Inter for the interface, JetBrains Mono for data. */
const FONTS: Pick<Palette, "fontSans" | "fontDisplay" | "fontMono"> = {
  fontSans: `"Inter Variable", "Inter", ${SANS_FALLBACK}`,
  fontDisplay: `"Space Grotesk Variable", "Inter Variable", ${SANS_FALLBACK}`,
  fontMono: `"JetBrains Mono Variable", "JetBrains Mono", ${MONO_FALLBACK}`,
};
/** Kit corners: 12px controls, 22px cards. */
const RADIUS: Pick<Palette, "radiusControl" | "radiusPanel"> = { radiusControl: "12px", radiusPanel: "22px" };

const LOOKS: Record<ThemeId, Look> = {
  aurora: { kitStatus: true, glow: true, ambient: true },
  ocean: { kitStatus: true, glow: true, ambient: true },
  ember: { kitStatus: true, glow: true, ambient: true },
  forest: { kitStatus: true, glow: true, ambient: true },
  clearsky: { kitStatus: false, glow: false, ambient: false },
  contrast: { kitStatus: false, glow: false, ambient: false },
};

/** Status hues are fixed per mode so "ok/warn/danger/info" read the same in every theme. */
const STATUS: Record<ThemeMode, Pick<Palette, "ok" | "warn" | "danger" | "info">> = {
  dark: { ok: "#3FB950", warn: "#FFD166", danger: "#FF6B6B", info: "#6FA8FF" },
  light: { ok: "#0F6B0F", warn: "#7E5300", danger: "#B3261E", info: "#1F4FB8" },
};
/** The kit's tones: green good, amber watch, rose alert, cyan info. Light looks use the darker set above. */
const KIT_STATUS: Record<ThemeMode, Pick<Palette, "ok" | "warn" | "danger" | "info">> = {
  dark: { ok: "#34D399", warn: "#FBBF24", danger: "#FB7185", info: "#22D3EE" },
  light: STATUS.light,
};

/** The kit's text colours, shared by its four dark looks (faint is a step above the kit's muted, for AA on fills). */
const KIT_TEXT = { ink: "#E9ECF8", dim: "#B7BDD8", faint: "#8B94B6" };

/** Core colours per kit theme and mode. Dark values are the kit's tokens; light looks are derived and AA-checked. */
const CORES: Record<"aurora" | "ocean" | "ember" | "forest", Record<ThemeMode, Core>> = {
  aurora: {
    dark: {
      bg: "#05060F", surface: "#0D1024", surface2: "#11152D", line: "#1F2236", lineStrong: "#5E668F", ...KIT_TEXT,
      primary: "#FF4D9D", primaryInk: "#05060F", accent2: "#22D3EE", ai: "#A78BFA",
      chart1: "#FF4D9D", chart2: "#22D3EE", chart3: "#A78BFA", chart4: "#FBBF24", chart5: "#34D399", chart6: "#60A5FA",
      globeLand: "#1C2145", globeOcean: "#070918", grad1: "#FF4D9D", grad2: "#A855F7", grad3: "#22D3EE",
    },
    light: {
      bg: "#F6F5FB", surface: "#FFFFFF", surface2: "#F0EEF8", line: "#E3E0EF", lineStrong: "#84809E",
      ink: "#0F0D24", dim: "#48455F", faint: "#5A5773", primary: "#B0154F", primaryInk: "#FFFFFF", accent2: "#0E7490", ai: "#6D28D9",
      chart1: "#B0154F", chart2: "#0E7490", chart3: "#6D28D9", chart4: "#A16207", chart5: "#15803D", chart6: "#1D4ED8",
      globeLand: "#D7D3E8", globeOcean: "#EFEDF7", grad1: "#B0154F", grad2: "#7C3AED", grad3: "#0E7490",
    },
  },
  ocean: {
    dark: {
      bg: "#04080F", surface: "#0A1626", surface2: "#0E1D31", line: "#1A2535", lineStrong: "#58698A", ...KIT_TEXT,
      primary: "#38BDF8", primaryInk: "#04080F", accent2: "#2DD4BF", ai: "#A5B4FC",
      chart1: "#38BDF8", chart2: "#2DD4BF", chart3: "#A5B4FC", chart4: "#FBBF24", chart5: "#34D399", chart6: "#FB7185",
      globeLand: "#13294A", globeOcean: "#050C18", grad1: "#38BDF8", grad2: "#818CF8", grad3: "#2DD4BF",
    },
    light: {
      bg: "#F4F8FC", surface: "#FFFFFF", surface2: "#EAF1F8", line: "#D8E2EE", lineStrong: "#78859A",
      ink: "#0B1A2B", dim: "#3F5168", faint: "#52637A", primary: "#0369A1", primaryInk: "#FFFFFF", accent2: "#0F766E", ai: "#4F46E5",
      chart1: "#0369A1", chart2: "#0F766E", chart3: "#4F46E5", chart4: "#A16207", chart5: "#15803D", chart6: "#BE123C",
      globeLand: "#CBD8E6", globeOcean: "#EAF1F8", grad1: "#0369A1", grad2: "#4F46E5", grad3: "#0F766E",
    },
  },
  ember: {
    dark: {
      bg: "#0B0605", surface: "#1A0E0B", surface2: "#22130F", line: "#2E2220", lineStrong: "#7A645E", ...KIT_TEXT,
      primary: "#FB923C", primaryInk: "#0B0605", accent2: "#FACC15", ai: "#C4B5FD",
      chart1: "#FB923C", chart2: "#FACC15", chart3: "#FDA4AF", chart4: "#34D399", chart5: "#60A5FA", chart6: "#C4B5FD",
      globeLand: "#3A2019", globeOcean: "#120907", grad1: "#FB923C", grad2: "#F43F5E", grad3: "#FACC15",
    },
    light: {
      bg: "#FBF7F4", surface: "#FFFFFF", surface2: "#F6EEE8", line: "#EADFD6", lineStrong: "#8E7E73",
      ink: "#24130D", dim: "#5A463C", faint: "#6B574D", primary: "#A63A08", primaryInk: "#FFFFFF", accent2: "#8A5A00", ai: "#6D28D9",
      chart1: "#A63A08", chart2: "#A16207", chart3: "#BE123C", chart4: "#15803D", chart5: "#1D4ED8", chart6: "#6D28D9",
      globeLand: "#E6D8CE", globeOcean: "#F6EEE8", grad1: "#A63A08", grad2: "#BE123C", grad3: "#A16207",
    },
  },
  forest: {
    dark: {
      bg: "#040A07", surface: "#0A1810", surface2: "#0F2117", line: "#1A2620", lineStrong: "#5A7A68", ...KIT_TEXT,
      primary: "#34D399", primaryInk: "#040A07", accent2: "#22D3EE", ai: "#C4B5FD",
      chart1: "#34D399", chart2: "#22D3EE", chart3: "#BEF264", chart4: "#FBBF24", chart5: "#FB7185", chart6: "#A5B4FC",
      globeLand: "#15331F", globeOcean: "#06100A", grad1: "#34D399", grad2: "#84CC16", grad3: "#22D3EE",
    },
    light: {
      bg: "#F4F9F6", surface: "#FFFFFF", surface2: "#E9F3ED", line: "#D5E6DC", lineStrong: "#738A7D",
      ink: "#0B1F15", dim: "#3D5547", faint: "#50675A", primary: "#065F46", primaryInk: "#FFFFFF", accent2: "#0E7490", ai: "#6D28D9",
      chart1: "#065F46", chart2: "#0E7490", chart3: "#4D7C0F", chart4: "#A16207", chart5: "#BE123C", chart6: "#4F46E5",
      globeLand: "#CFE2D6", globeOcean: "#E9F3ED", grad1: "#065F46", grad2: "#4D7C0F", grad3: "#0E7490",
    },
  },
};

const FIXED_CORES: Record<"clearsky" | "contrast", Core> = {
  clearsky: {
    bg: "#FFFFFF", surface: "#F6F8FB", surface2: "#EDF1F6", line: "#C3CCD8", lineStrong: "#7B8A9E",
    ink: "#0B1220", dim: "#334155", faint: "#4B5768", primary: "#0B57D0", primaryInk: "#FFFFFF", accent2: "#7A3E00", ai: "#5B2FC0",
    chart1: "#0B57D0", chart2: "#7A3E00", chart3: "#0F6B0F", chart4: "#B3261E", chart5: "#5B2FC0", chart6: "#0B6F84",
    globeLand: "#C3CCD8", globeOcean: "#EDF1F6", grad1: "#0B57D0", grad2: "#5B2FC0", grad3: "#0B6F84",
  },
  contrast: {
    bg: "#000000", surface: "#000000", surface2: "#111111", line: "#FFFFFF", lineStrong: "#FFFFFF",
    ink: "#FFFFFF", dim: "#F0F0F0", faint: "#D6D6D6", primary: "#FFE600", primaryInk: "#000000", accent2: "#66E0FF", ai: "#D7B8FF",
    chart1: "#FFE600", chart2: "#66E0FF", chart3: "#FF8FB1", chart4: "#7CFC7C", chart5: "#FF9A3C", chart6: "#D7B8FF",
    globeLand: "#3A3A3A", globeOcean: "#000000", grad1: "#FFE600", grad2: "#FFE600", grad3: "#FFE600",
  },
};

/** High-contrast neutrals laid over a toggle theme; its accents stay (darkened where AA needs it). */
const HIGH_CONTRAST: Record<ThemeMode, Partial<Core>> = {
  dark: {
    bg: "#000000", surface: "#060606", surface2: "#101010", line: "#BDBDBD", lineStrong: "#E0E0E0",
    ink: "#FFFFFF", dim: "#E8E8E8", faint: "#CFCFCF", primaryInk: "#000000", globeLand: "#3A3A3A", globeOcean: "#050505",
  },
  light: {
    bg: "#FFFFFF", surface: "#FFFFFF", surface2: "#F0F0F0", line: "#3A3A3A", lineStrong: "#1A1A1A",
    ink: "#000000", dim: "#1C1C1C", faint: "#333333", globeLand: "#BDBDBD", globeOcean: "#F0F0F0",
  },
};

/**
 * Light high-contrast primaries, darkened so primary text still clears 4.5:1 on the stronger hover and
 * selected fills (ink 10% / primary 18% over #F0F0F0).
 */
const HIGH_CONTRAST_ACCENTS: Partial<Record<ThemeId, Partial<Record<ThemeMode, Partial<Core>>>>> = {
  aurora: { light: { primary: "#96123F", grad1: "#96123F" } },
  ocean: { light: { primary: "#035A8A", grad1: "#035A8A" } },
  ember: { light: { primary: "#8F3207", grad1: "#8F3207" } },
  forest: { light: { primary: "#05523C", grad1: "#05523C" } },
};

/** `#RRGGBB` at an alpha, as a CSS colour. */
function alpha(hex: string, amount: number): string {
  const value = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((at) => Number.parseInt(value.slice(at, at + 2), 16));
  return `rgb(${r} ${g} ${b} / ${amount})`;
}

const WHITE = "#FFFFFF";
/** Interaction alphas. The contrast tests composite these over every surface. */
const HOVER = { dark: 0.04, light: 0.035, flat: 0.1 };
const SELECTED = { dark: 0.1, light: 0.08, flat: 0.18 };
/** Primary button hover / pressed: the primary pushed towards the text colour, which only raises primary-ink contrast. */
const PRIMARY_HOVER = 0.12;
const PRIMARY_ACTIVE = 0.2;
/** "No shadow" that still works inside Tailwind's composed box-shadow lists (unlike `none`). */
export const NO_SHADOW = "0 0 #0000";
/**
 * WebGL clear colour for the globe canvas: fully transparent. The globe library parses it as a colour string and
 * rejects the keyword `transparent`, so it is spelled out here.
 */
export const CLEAR_CANVAS = "rgba(0, 0, 0, 0)";

/** A 135-degree gradient through three stops (the kit's `--grad`). */
function gradient(a: string, b: string, c: string): string {
  return `linear-gradient(135deg, ${a} 0%, ${b} 50%, ${c} 100%)`;
}

function build(core: Core, look: Look, mode: ThemeMode, flat: boolean): Palette {
  const dark = mode === "dark";
  const ambient = look.ambient && !flat;
  return {
    ...core,
    primaryHover: compositeOver(core.ink, core.primary, PRIMARY_HOVER),
    primaryActive: compositeOver(core.ink, core.primary, PRIMARY_ACTIVE),
    ...(look.kitStatus ? KIT_STATUS : STATUS)[mode],
    chartGrid: alpha(core.dim, 0.12),
    chartAxis: core.dim,
    glow: look.glow && dark && !flat ? alpha(core.primary, 0.35) : "transparent",
    shadow: flat
      ? NO_SHADOW
      : dark
        ? "0 20px 60px rgb(0 0 0 / 0.45), 0 0 0 1px rgb(0 0 0 / 0.2)"
        : `0 12px 32px -12px ${alpha(core.ink, 0.22)}, 0 0 0 1px ${alpha(core.ink, 0.04)}`,
    shadowFrame: flat ? NO_SHADOW : dark ? "0 32px 64px -32px rgb(0 0 0 / 0.6)" : `0 32px 64px -32px ${alpha(core.ink, 0.28)}`,
    shadowRaise: flat
      ? NO_SHADOW
      : dark
        ? "inset 0 1px 0 rgb(255 255 255 / 0.08), 0 4px 14px rgb(0 0 0 / 0.4)"
        : `0 1px 2px ${alpha(core.ink, 0.12)}`,
    backdrop: dark ? alpha(core.bg, flat ? 0.88 : 0.6) : alpha(core.ink, flat ? 0.6 : 0.32),
    hover: alpha(core.ink, flat ? HOVER.flat : HOVER[mode]),
    selected: alpha(core.primary, flat ? SELECTED.flat : SELECTED[mode]),
    skeleton: alpha(core.dim, dark ? 0.1 : 0.09),
    dot: ambient ? alpha(core.ink, dark ? 0.07 : 0.08) : "transparent",
    tintFill: flat ? "0%" : dark ? "13%" : "8%",
    tintEdge: flat ? "100%" : dark ? "32%" : "28%",
    card: flat ? core.surface : dark ? alpha(WHITE, 0.035) : alpha(WHITE, 0.72),
    card2: flat ? core.surface2 : dark ? alpha(WHITE, 0.06) : alpha(core.ink, 0.04),
    chrome: flat ? core.bg : dark ? alpha(core.bg, 0.72) : alpha(core.surface, 0.82),
    lineSoft: flat ? core.lineStrong : dark ? compositeOver(WHITE, core.surface, 0.14) : compositeOver(core.ink, core.surface, 0.14),
    grad: gradient(core.grad1, core.grad2, core.grad3),
    gradSoft: flat
      ? gradient(alpha(core.primary, SELECTED.flat), alpha(core.primary, SELECTED.flat), alpha(core.primary, SELECTED.flat))
      : gradient(alpha(core.grad1, dark ? 0.18 : 0.1), alpha(core.grad2, dark ? 0.14 : 0.08), alpha(core.grad3, dark ? 0.12 : 0.07)),
    ambient1: ambient ? alpha(core.grad1, dark ? 0.16 : 0.1) : "transparent",
    ambient2: ambient ? alpha(core.grad3, dark ? 0.1 : 0.08) : "transparent",
    ambient3: ambient ? alpha(core.grad2, dark ? 0.14 : 0.08) : "transparent",
    hudGrid: ambient ? (dark ? alpha(WHITE, 0.025) : alpha(core.ink, 0.035)) : "transparent",
    ...RADIUS,
    ...FONTS,
  };
}

function compute(choice: ThemeChoice): Palette {
  const { theme, mode, contrast } = choice;
  const look = LOOKS[theme];
  if (theme === "clearsky" || theme === "contrast") {
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

/** The six themes in switcher order. Each swatch is its default look's bg, surface, primary and second accent. */
export const THEMES: readonly ThemeMeta[] = THEME_INFO.map((info) => {
  const palette = resolvePalette({ theme: info.id, mode: "dark", contrast: false });
  return { ...info, swatch: [palette.bg, palette.surface, palette.primary, palette.accent2] as const };
});

export function themeMeta(id: ThemeId): ThemeMeta {
  return THEMES.find((theme) => theme.id === id) ?? (THEMES[0] as ThemeMeta);
}

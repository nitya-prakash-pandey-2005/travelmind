export type ThemeId = "orbital" | "nebula" | "ember" | "clearsky" | "terminal" | "contrast";

export type ThemeMode = "dark" | "light";

/** What the viewer picked. Fixed themes (Clearsky, Terminal, Contrast) override `mode` and `contrast`. */
export type ThemeChoice = { theme: ThemeId; mode: ThemeMode; contrast: boolean };

/** "toggle": dark/light and high contrast are the viewer's call; "fixed-*": the theme has exactly one look. */
export type ThemeModes = "toggle" | "fixed-light" | "fixed-dark";

export type ThemeMeta = {
  id: ThemeId;
  name: string;
  tagline: string;
  /** Four colours for the switcher's preview chip: background, surface, primary, second accent. */
  swatch: readonly [string, string, string, string];
  modes: ThemeModes;
};

/**
 * Every token a theme defines. Each key is written to a `--tm-*` custom property (see TOKEN_VARS) that the
 * Tailwind colour names (`bg`, `surface`, `ink`, `primary`, `chart-1` ...) read, so components never hold colours.
 */
export type Palette = {
  bg: string;
  surface: string;
  surface2: string;
  line: string;
  lineStrong: string;
  ink: string;
  dim: string;
  faint: string;
  primary: string;
  primaryInk: string;
  accent2: string;
  ok: string;
  warn: string;
  danger: string;
  info: string;
  ai: string;
  chart1: string;
  chart2: string;
  chart3: string;
  chart4: string;
  chart5: string;
  chart6: string;
  chartGrid: string;
  chartAxis: string;
  globeLand: string;
  globeOcean: string;
  glow: string;
  shadow: string;
  backdrop: string;
  hover: string;
  selected: string;
  skeleton: string;
  dot: string;
  tintFill: string;
  tintEdge: string;
  radiusControl: string;
  radiusPanel: string;
  fontSans: string;
  fontDisplay: string;
  fontMono: string;
};

export type PaletteToken = keyof Palette;

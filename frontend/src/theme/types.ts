/** The four UI-kit looks (aurora is the default) plus the two accessibility looks. */
export type ThemeId = "aurora" | "ocean" | "ember" | "forest" | "clearsky" | "contrast";

export type ThemeMode = "dark" | "light";

/** What the viewer picked. Fixed themes (Clearsky, Contrast) override `mode` and `contrast`. */
export type ThemeChoice = { theme: ThemeId; mode: ThemeMode; contrast: boolean };

/** "toggle": dark/light and high contrast are the viewer's call; "fixed-*": the theme has exactly one look. */
export type ThemeModes = "toggle" | "fixed-light" | "fixed-dark";

export type ThemeMeta = {
  id: ThemeId;
  name: string;
  tagline: string;
  /** Four colours for the switcher's preview chip, from the theme's default look: bg, surface, primary, accent-2. */
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
  /** Primary fills on hover and while pressed (opaque, so primary-ink contrast is exact). */
  primaryHover: string;
  primaryActive: string;
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
  /** Popovers and dialogs. */
  shadow: string;
  /** Large framed previews on the landing and sign-in pages. */
  shadowFrame: string;
  /** The raised thumb of a segmented control. */
  shadowRaise: string;
  backdrop: string;
  hover: string;
  selected: string;
  skeleton: string;
  dot: string;
  tintFill: string;
  tintEdge: string;
  /** Glass card fill (translucent over the ambient background; opaque in flat looks). */
  card: string;
  /** Raised glass: hover rows, chips, icon tiles. */
  card2: string;
  /** Translucent chrome: sidebar, top bar and tab bar over the page (opaque in flat looks). */
  chrome: string;
  /** Decorative hairline a step stronger than `line` (buttons, sheets, chips). */
  lineSoft: string;
  /** The three stops of the accent gradient (primary actions, active navigation). Opaque, so primary-ink is checked on each. */
  grad1: string;
  grad2: string;
  grad3: string;
  /** The accent gradient itself, and its soft tint for selected navigation. */
  grad: string;
  gradSoft: string;
  /** Ambient page glows (top-left, right, bottom) and the faint HUD grid over them. Transparent where ambience is off. */
  ambient1: string;
  ambient2: string;
  ambient3: string;
  hudGrid: string;
  radiusControl: string;
  radiusPanel: string;
  fontSans: string;
  fontDisplay: string;
  fontMono: string;
};

export type PaletteToken = keyof Palette;

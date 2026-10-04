import { describe, expect, test } from "vitest";
import { ALL_CHOICES, coerceChoice, NO_SHADOW, resolvePalette, THEMES, TOKEN_VARS } from "../palettes";
import type { PaletteToken, ThemeChoice } from "../types";

const HEX = /^#[0-9A-F]{6}$/;
/** Tokens that hold a plain colour (the rest are mixes, shadows, sizes or font stacks). */
const HEX_TOKENS: PaletteToken[] = [
  "bg", "surface", "surface2", "line", "lineStrong", "ink", "dim", "faint", "primary", "primaryInk", "primaryHover", "primaryActive", "accent2",
  "ok", "warn", "danger", "info", "ai", "chart1", "chart2", "chart3", "chart4", "chart5", "chart6", "chartAxis",
  "globeLand", "globeOcean", "grad1", "grad2", "grad3",
];

const label = (choice: ThemeChoice) => `${choice.theme}/${choice.mode}${choice.contrast ? "/high-contrast" : ""}`;

test("six themes in switcher order, each with a name, tagline, four-colour swatch and mode rule", () => {
  expect(THEMES.map((theme) => theme.id)).toEqual(["aurora", "ocean", "ember", "forest", "clearsky", "contrast"]);
  expect(THEMES.map((theme) => theme.name)).toEqual(["Aurora", "Ocean", "Ember", "Forest", "Clearsky", "Contrast"]);
  for (const theme of THEMES) {
    expect(theme.tagline.length).toBeGreaterThan(10);
    expect(theme.swatch).toHaveLength(4);
    for (const colour of theme.swatch) expect(colour).toMatch(HEX);
  }
  expect(Object.fromEntries(THEMES.map((theme) => [theme.id, theme.modes]))).toEqual({
    aurora: "toggle",
    ocean: "toggle",
    ember: "toggle",
    forest: "toggle",
    clearsky: "fixed-light",
    contrast: "fixed-dark",
  });
});

test("swatches come from each theme's default look: bg, surface, primary, accent-2", () => {
  for (const theme of THEMES) {
    const palette = resolvePalette({ theme: theme.id, mode: "dark", contrast: false });
    expect(theme.swatch, theme.id).toEqual([palette.bg, palette.surface, palette.primary, palette.accent2]);
  }
});

test("every theme x mode x contrast resolves to a distinct, already-coerced choice", () => {
  // 4 toggle themes x 2 modes x 2 contrast settings + 2 fixed looks.
  expect(ALL_CHOICES).toHaveLength(18);
  for (const choice of ALL_CHOICES) expect(coerceChoice(choice)).toEqual(choice);
  expect(new Set(ALL_CHOICES.map(label)).size).toBe(18);
});

describe.each(ALL_CHOICES.map((choice) => [label(choice), choice] as const))("%s", (_name, choice) => {
  test("defines every token", () => {
    const palette = resolvePalette(choice);
    for (const token of Object.keys(TOKEN_VARS) as PaletteToken[]) {
      expect(typeof palette[token], token).toBe("string");
      expect(palette[token].trim(), token).not.toBe("");
    }
    expect(Object.keys(palette).sort()).toEqual(Object.keys(TOKEN_VARS).sort());
  });

  test("plain colour tokens are six-digit hex", () => {
    const palette = resolvePalette(choice);
    for (const token of HEX_TOKENS) expect(palette[token], token).toMatch(HEX);
  });
});

test("each token has its own --tm-* property and the names the components already use are kept", () => {
  const names = Object.values(TOKEN_VARS);
  expect(new Set(names).size).toBe(names.length);
  for (const name of names) expect(name).toMatch(/^--tm-[a-z0-9-]+$/);
  expect(TOKEN_VARS).toMatchObject({
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
    chart1: "--tm-chart-1",
    chartGrid: "--tm-chart-grid",
    globeLand: "--tm-globe-land",
    shadow: "--tm-shadow-pop",
    backdrop: "--tm-backdrop",
  });
});

test("fixed themes coerce mode and contrast; toggle themes keep them", () => {
  expect(coerceChoice({ theme: "clearsky", mode: "dark", contrast: true })).toEqual({ theme: "clearsky", mode: "light", contrast: false });
  expect(coerceChoice({ theme: "contrast", mode: "light", contrast: true })).toEqual({ theme: "contrast", mode: "dark", contrast: false });
  expect(coerceChoice({ theme: "ember", mode: "light", contrast: true })).toEqual({ theme: "ember", mode: "light", contrast: true });
});

test("the kit themes carry the kit's tokens in their dark looks", () => {
  expect(resolvePalette({ theme: "aurora", mode: "dark", contrast: false })).toMatchObject({
    bg: "#05060F", surface: "#0D1024", surface2: "#11152D", ink: "#E9ECF8", dim: "#B7BDD8", primary: "#FF4D9D",
    grad1: "#FF4D9D", grad2: "#A855F7", grad3: "#22D3EE", ok: "#34D399", warn: "#FBBF24", danger: "#FB7185", info: "#22D3EE",
  });
  expect(resolvePalette({ theme: "ocean", mode: "dark", contrast: false })).toMatchObject({ bg: "#04080F", surface: "#0A1626", primary: "#38BDF8", grad3: "#2DD4BF" });
  expect(resolvePalette({ theme: "ember", mode: "dark", contrast: false })).toMatchObject({ bg: "#0B0605", surface: "#1A0E0B", primary: "#FB923C", grad2: "#F43F5E" });
  expect(resolvePalette({ theme: "forest", mode: "dark", contrast: false })).toMatchObject({ bg: "#040A07", surface: "#0A1810", primary: "#34D399", grad2: "#84CC16" });
  const aurora = resolvePalette({ theme: "aurora", mode: "dark", contrast: false });
  expect(aurora.grad).toBe("linear-gradient(135deg, #FF4D9D 0%, #A855F7 50%, #22D3EE 100%)");
  expect(aurora.card).toBe("rgb(255 255 255 / 0.035)");
  expect(aurora.card2).toBe("rgb(255 255 255 / 0.06)");
  expect(aurora.ambient1).toBe("rgb(255 77 157 / 0.16)");
  expect(aurora.hudGrid).toBe("rgb(255 255 255 / 0.025)");
  expect(aurora).toMatchObject({ radiusControl: "12px", radiusPanel: "22px" });
});

test("the accessibility looks keep their anchors", () => {
  expect(resolvePalette({ theme: "clearsky", mode: "light", contrast: false })).toMatchObject({ bg: "#FFFFFF", primary: "#0B57D0", ok: "#0F6B0F", danger: "#B3261E" });
  expect(resolvePalette({ theme: "contrast", mode: "dark", contrast: false })).toMatchObject({ bg: "#000000", ink: "#FFFFFF", primary: "#FFE600" });
  expect(resolvePalette({ theme: "ocean", mode: "dark", contrast: true })).toMatchObject({ bg: "#000000", ink: "#FFFFFF", primary: "#38BDF8" });
  expect(resolvePalette({ theme: "ember", mode: "light", contrast: true })).toMatchObject({ bg: "#FFFFFF", ink: "#000000" });
});

test("resolving the same look twice returns the same object (stable for memoised consumers)", () => {
  const a = resolvePalette({ theme: "ocean", mode: "light", contrast: false });
  expect(resolvePalette({ theme: "ocean", mode: "light", contrast: false })).toBe(a);
  // A fixed theme resolves to its one look whatever mode was asked for.
  expect(resolvePalette({ theme: "contrast", mode: "light", contrast: true })).toBe(resolvePalette({ theme: "contrast", mode: "dark", contrast: false }));
});

test("every look uses the kit's faces: Space Grotesk titles, Inter interface, JetBrains Mono data", () => {
  for (const choice of ALL_CHOICES) {
    const palette = resolvePalette(choice);
    expect(palette.fontDisplay, label(choice)).toMatch(/^"Space Grotesk Variable"/);
    expect(palette.fontSans, label(choice)).toMatch(/^"Inter Variable"/);
    expect(palette.fontMono, label(choice)).toMatch(/^"JetBrains Mono Variable"/);
  }
});

test("Contrast and high-contrast looks drop shadows, glow and translucent tints", () => {
  for (const choice of ALL_CHOICES.filter((c) => c.contrast || c.theme === "contrast")) {
    const palette = resolvePalette(choice);
    expect(palette.shadow, label(choice)).toBe(NO_SHADOW);
    expect(palette.shadowFrame, label(choice)).toBe(NO_SHADOW);
    expect(palette.shadowRaise, label(choice)).toBe(NO_SHADOW);
    expect(palette.glow, label(choice)).toBe("transparent");
    expect(palette.tintFill, label(choice)).toBe("0%");
    // No see-through glass or ambient glow: cards are the opaque surfaces and the page is plain.
    expect(palette.card, label(choice)).toMatch(HEX);
    expect(palette.card2, label(choice)).toMatch(HEX);
    expect(palette.chrome, label(choice)).toBe(palette.bg);
    for (const token of ["ambient1", "ambient2", "ambient3", "hudGrid", "dot"] as const) {
      expect(palette[token], `${label(choice)} ${token}`).toBe("transparent");
    }
  }
});

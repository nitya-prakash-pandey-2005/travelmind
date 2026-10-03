import { describe, expect, test } from "vitest";
import { ALL_CHOICES, coerceChoice, NO_SHADOW, resolvePalette, THEMES, TOKEN_VARS } from "../palettes";
import type { PaletteToken, ThemeChoice } from "../types";

const HEX = /^#[0-9A-F]{6}$/;
/** Tokens that hold a plain colour (the rest are mixes, shadows, sizes or font stacks). */
const HEX_TOKENS: PaletteToken[] = [
  "bg", "surface", "surface2", "line", "lineStrong", "ink", "dim", "faint", "primary", "primaryInk", "primaryHover", "primaryActive", "accent2",
  "ok", "warn", "danger", "info", "ai", "chart1", "chart2", "chart3", "chart4", "chart5", "chart6", "chartAxis",
  "globeLand", "globeOcean",
];

const label = (choice: ThemeChoice) => `${choice.theme}/${choice.mode}${choice.contrast ? "/high-contrast" : ""}`;

test("six themes in switcher order, each with a name, tagline, four-colour swatch and mode rule", () => {
  expect(THEMES.map((theme) => theme.id)).toEqual(["orbital", "nebula", "ember", "clearsky", "terminal", "contrast"]);
  expect(THEMES.map((theme) => theme.name)).toEqual(["Orbital", "Nebula", "Ember", "Clearsky", "Terminal", "Contrast"]);
  for (const theme of THEMES) {
    expect(theme.tagline.length).toBeGreaterThan(10);
    expect(theme.swatch).toHaveLength(4);
    for (const colour of theme.swatch) expect(colour).toMatch(HEX);
  }
  expect(Object.fromEntries(THEMES.map((theme) => [theme.id, theme.modes]))).toEqual({
    orbital: "toggle",
    nebula: "toggle",
    ember: "toggle",
    clearsky: "fixed-light",
    terminal: "fixed-dark",
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
  // 3 toggle themes x 2 modes x 2 contrast settings + 3 fixed looks.
  expect(ALL_CHOICES).toHaveLength(15);
  for (const choice of ALL_CHOICES) expect(coerceChoice(choice)).toEqual(choice);
  expect(new Set(ALL_CHOICES.map(label)).size).toBe(15);
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
  expect(coerceChoice({ theme: "terminal", mode: "light", contrast: true })).toEqual({ theme: "terminal", mode: "dark", contrast: false });
  expect(coerceChoice({ theme: "contrast", mode: "light", contrast: true })).toEqual({ theme: "contrast", mode: "dark", contrast: false });
  expect(coerceChoice({ theme: "ember", mode: "light", contrast: true })).toEqual({ theme: "ember", mode: "light", contrast: true });
});

test("palettes carry the spec's anchor colours", () => {
  expect(resolvePalette({ theme: "orbital", mode: "dark", contrast: false })).toMatchObject({ bg: "#0A0C10", primary: "#3CC6F0", accent2: "#F0B429" });
  // Light primaries sit a step darker than the spec's values so primary text clears 4.5:1 on hover and selected fills.
  expect(resolvePalette({ theme: "orbital", mode: "light", contrast: false })).toMatchObject({ bg: "#F6F7F9", ink: "#0E131B", primary: "#076CA1" });
  expect(resolvePalette({ theme: "nebula", mode: "dark", contrast: false })).toMatchObject({ bg: "#070619", primary: "#8EF3FF", accent2: "#C9A7FF" });
  expect(resolvePalette({ theme: "nebula", mode: "light", contrast: false })).toMatchObject({ primary: "#0A6A7E", accent2: "#6B3FC9" });
  expect(resolvePalette({ theme: "ember", mode: "dark", contrast: false })).toMatchObject({ bg: "#080B1C", primary: "#FF9933", accent2: "#3FB950" });
  expect(resolvePalette({ theme: "ember", mode: "light", contrast: false })).toMatchObject({ ink: "#14213D", primary: "#9F4F00" });
  expect(resolvePalette({ theme: "clearsky", mode: "light", contrast: false })).toMatchObject({ bg: "#FFFFFF", primary: "#0B57D0" });
  expect(resolvePalette({ theme: "terminal", mode: "dark", contrast: false })).toMatchObject({ ink: "#FFB000", primary: "#FFD27A" });
  expect(resolvePalette({ theme: "contrast", mode: "dark", contrast: false })).toMatchObject({ bg: "#000000", ink: "#FFFFFF", primary: "#FFE600" });
  expect(resolvePalette({ theme: "nebula", mode: "dark", contrast: true })).toMatchObject({ bg: "#000000", ink: "#FFFFFF", primary: "#8EF3FF" });
  expect(resolvePalette({ theme: "ember", mode: "light", contrast: true })).toMatchObject({ bg: "#FFFFFF", ink: "#000000" });
  expect(resolvePalette({ theme: "orbital", mode: "dark", contrast: false })).toMatchObject({ ok: "#3FB950", danger: "#FF6B6B" });
  expect(resolvePalette({ theme: "clearsky", mode: "light", contrast: false })).toMatchObject({ ok: "#0F6B0F", danger: "#B3261E" });
});

test("resolving the same look twice returns the same object (stable for memoised consumers)", () => {
  const a = resolvePalette({ theme: "nebula", mode: "light", contrast: false });
  expect(resolvePalette({ theme: "nebula", mode: "light", contrast: false })).toBe(a);
  // A fixed theme resolves to its one look whatever mode was asked for.
  expect(resolvePalette({ theme: "terminal", mode: "light", contrast: true })).toBe(resolvePalette({ theme: "terminal", mode: "dark", contrast: false }));
});

test("theme fonts: Terminal is monospace throughout, Ember titles use Fraunces, Nebula uses Sora", () => {
  const terminal = resolvePalette({ theme: "terminal", mode: "dark", contrast: false });
  expect(terminal.fontSans).toMatch(/^"IBM Plex Mono"/);
  expect(terminal.fontDisplay).toMatch(/^"IBM Plex Mono"/);
  expect(terminal.radiusControl).toBe("0px");
  expect(resolvePalette({ theme: "ember", mode: "dark", contrast: false }).fontDisplay).toMatch(/^"Fraunces"/);
  expect(resolvePalette({ theme: "nebula", mode: "dark", contrast: false }).fontSans).toMatch(/^"Sora Variable"/);
  expect(resolvePalette({ theme: "orbital", mode: "dark", contrast: false }).fontMono).toMatch(/^"JetBrains Mono"/);
});

test("Contrast and high-contrast looks drop shadows, glow and translucent tints", () => {
  for (const choice of ALL_CHOICES.filter((c) => c.contrast || c.theme === "contrast")) {
    const palette = resolvePalette(choice);
    expect(palette.shadow, label(choice)).toBe(NO_SHADOW);
    expect(palette.shadowFrame, label(choice)).toBe(NO_SHADOW);
    expect(palette.shadowRaise, label(choice)).toBe(NO_SHADOW);
    expect(palette.glow, label(choice)).toBe("transparent");
    expect(palette.tintFill, label(choice)).toBe("0%");
  }
});

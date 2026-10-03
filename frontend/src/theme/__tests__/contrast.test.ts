import { describe, expect, test } from "vitest";
import { compositeOver, contrastRatio } from "../contrast";
import { ALL_CHOICES, resolvePalette } from "../palettes";
import type { Palette, PaletteToken, ThemeChoice } from "../types";

test("contrastRatio matches WCAG reference values", () => {
  expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 5);
  expect(contrastRatio("#FFFFFF", "#000000")).toBeCloseTo(21, 5);
  expect(contrastRatio("#3CC6F0", "#3CC6F0")).toBe(1);
  expect(contrastRatio("#777777", "#FFFFFF")).toBeCloseTo(4.48, 2);
  expect(contrastRatio("#0875af", "#ffffff")).toBeCloseTo(contrastRatio("#0875AF", "#FFFFFF"), 10);
});

test("compositeOver blends a colour at an alpha over an opaque background", () => {
  expect(compositeOver("#FFFFFF", "#000000", 0.5)).toBe("#808080");
  expect(compositeOver("#3CC6F0", "#0A0C10", 0)).toBe("#0A0C10");
  expect(compositeOver("#3CC6F0", "#0A0C10", 1)).toBe("#3CC6F0");
});

const BODY = 4.5;
const GRAPHIC = 3;
const BACKGROUNDS: PaletteToken[] = ["bg", "surface", "surface2"];
/** Text tokens: body copy, secondary and tertiary text (micro labels), links/actions, status and AI labels, title accent. */
const TEXT: PaletteToken[] = ["ink", "dim", "faint", "primary", "accent2", "ok", "warn", "danger", "info", "ai", "chartAxis"];
const STATUS: PaletteToken[] = ["ok", "warn", "danger", "info", "ai"];
const CHARTS: PaletteToken[] = ["chart1", "chart2", "chart3", "chart4", "chart5", "chart6"];

function failures(palette: Palette): string[] {
  const found: string[] = [];
  const check = (fg: string, bg: string, min: number, what: string) => {
    const ratio = contrastRatio(fg, bg);
    if (ratio < min) found.push(`${what} ${ratio.toFixed(2)}:1 < ${min}:1`);
  };
  for (const bg of BACKGROUNDS) {
    for (const text of TEXT) check(palette[text], palette[bg], BODY, `${text} on ${bg}`);
    for (const chart of CHARTS) check(palette[chart], palette[bg], GRAPHIC, `${chart} on ${bg}`);
    // Status pills: tone text over its own tint of the surface (tm-tint).
    const fill = Number.parseFloat(palette.tintFill) / 100;
    for (const tone of STATUS) check(palette[tone], compositeOver(palette[tone], palette[bg], fill), BODY, `${tone} pill on ${bg}`);
  }
  check(palette.primaryInk, palette.primary, BODY, "primary-ink on primary");
  return found;
}

const label = (choice: ThemeChoice) => `${choice.theme}/${choice.mode}${choice.contrast ? "/high-contrast" : ""}`;

describe("WCAG AA in every theme x mode x contrast", () => {
  test.each(ALL_CHOICES.map((choice) => [label(choice), choice] as const))("%s", (_name, choice) => {
    expect(failures(resolvePalette(choice))).toEqual([]);
  });
});

test("high-contrast looks clear 7:1 (AAA) for body and secondary text", () => {
  for (const choice of ALL_CHOICES.filter((c) => c.contrast || c.theme === "contrast")) {
    const palette = resolvePalette(choice);
    for (const bg of BACKGROUNDS) {
      expect(contrastRatio(palette.ink, palette[bg]), label(choice)).toBeGreaterThanOrEqual(7);
      expect(contrastRatio(palette.dim, palette[bg]), label(choice)).toBeGreaterThanOrEqual(7);
    }
  }
});

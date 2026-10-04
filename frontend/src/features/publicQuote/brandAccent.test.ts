import { expect, test } from "vitest";
import { contrastRatio, resolvePalette } from "../../theme";
import { brandAccent, printCss, printPalette } from "./brandAccent";

const LIGHT = resolvePalette({ theme: "clearsky", mode: "light", contrast: false });
const DARK = resolvePalette({ theme: "aurora", mode: "dark", contrast: false });

test("a brand colour that stands out from the page is used, with readable text on it", () => {
  const accent = brandAccent("#0F766E", LIGHT);
  expect(accent.fromBrand).toBe(true);
  expect(accent.accent).toBe("#0F766E");
  expect(contrastRatio(accent.accentInk, accent.accent)).toBeGreaterThanOrEqual(4.5);
  expect(contrastRatio(accent.accentInk, accent.accentHover)).toBeGreaterThanOrEqual(
    contrastRatio(accent.accentInk, accent.accent),
  );
});

test("a brand colour too close to the page falls back to the theme primary", () => {
  // Cyan on a near-white page, navy on a near-black one.
  expect(brandAccent("#22D3EE", LIGHT)).toEqual({
    accent: LIGHT.primary,
    accentInk: LIGHT.primaryInk,
    accentHover: LIGHT.primaryHover,
    fromBrand: false,
  });
  expect(brandAccent("#1E3A8A", DARK).fromBrand).toBe(false);
  expect(brandAccent("#22D3EE", DARK).fromBrand).toBe(true);
});

test("anything but a well-formed #rrggbb keeps the theme primary", () => {
  for (const value of ["", "teal", "#0F766", "#0F766EZ", "url(x)", "#0F766E; color: red"]) {
    expect(brandAccent(value, LIGHT).fromBrand).toBe(false);
  }
});

test("print always uses a light page", () => {
  expect(contrastRatio(printPalette().bg, printPalette().ink)).toBeGreaterThanOrEqual(7);
});

test("print paints the whole sheet light, html and body included", () => {
  const css = printCss("[data-public-quote]", "#0F766E");
  expect(css).toContain(`html, body { background: ${printPalette().bg} !important; }`);
});

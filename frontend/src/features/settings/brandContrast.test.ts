import { expect, test } from "vitest";
import { contrastRatio, resolvePalette } from "../../theme";
import { MIN_ACCENT_CONTRAST, brandChecks, brandInk, isBrandColor, normaliseBrandInput } from "./brandContrast";

const DARK = resolvePalette({ theme: "orbital", mode: "dark", contrast: false });
const LIGHT = resolvePalette({ theme: "orbital", mode: "light", contrast: false });

test("a brand colour is exactly # and six lower-case hex digits", () => {
  expect(isBrandColor("#0b84c6")).toBe(true);
  for (const bad of ["#0B84C6", "0b84c6", "#0b84c", "#0b84c6f", "#0b84cg", " #0b84c6", "", "blue"]) {
    expect(isBrandColor(bad), bad).toBe(false);
  }
});

test("typed input is trimmed and lower-cased, and gains a missing #", () => {
  expect(normaliseBrandInput("  #0B84C6 ")).toBe("#0b84c6");
  expect(normaliseBrandInput("0b84c6")).toBe("#0b84c6");
  expect(normaliseBrandInput("#0b8")).toBe("#0b8");
  expect(normaliseBrandInput("")).toBe("");
});

test("each theme is checked against both its page and its cards, keeping the weaker ratio", () => {
  const [dark, light] = brandChecks("#0b84c6");
  expect(dark?.mode).toBe("dark");
  expect(light?.mode).toBe("light");
  expect(dark?.ratio).toBeCloseTo(Math.min(contrastRatio("#0b84c6", DARK.bg), contrastRatio("#0b84c6", DARK.surface)), 5);
  expect(light?.ratio).toBeCloseTo(Math.min(contrastRatio("#0b84c6", LIGHT.bg), contrastRatio("#0b84c6", LIGHT.surface)), 5);
  expect(dark?.passes && light?.passes).toBe(true);
});

test("a colour below 3:1 on either theme fails that theme", () => {
  const [darkOnBlack, lightOnBlack] = brandChecks("#000000");
  expect(darkOnBlack?.passes).toBe(false);
  expect(lightOnBlack?.passes).toBe(true);
  const [darkOnWhite, lightOnWhite] = brandChecks("#ffffff");
  expect(darkOnWhite?.passes).toBe(true);
  expect(lightOnWhite?.passes).toBe(false);
  expect(lightOnWhite?.ratio).toBeLessThan(MIN_ACCENT_CONTRAST);
});

test("an invalid colour has no checks", () => {
  expect(brandChecks("#12")).toEqual([]);
});

test("text on the accent is the theme colour that reads best on it", () => {
  expect(brandInk("#ffffff", LIGHT)).toBe(LIGHT.ink);
  expect(brandInk("#000000", DARK)).toBe(DARK.ink);
  expect(contrastRatio(brandInk("#0b84c6", DARK), "#0b84c6")).toBeGreaterThanOrEqual(4.5);
});

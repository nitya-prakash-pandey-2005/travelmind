import { expect, test } from "vitest";
import { contrastRatio, resolvePalette } from "../../theme";
import { brandAccent } from "../publicQuote/brandAccent";
import { MIN_ACCENT_CONTRAST, MIN_TEXT_CONTRAST, brandChecks, isBrandColor, normaliseBrandInput } from "./brandContrast";

const DARK = resolvePalette({ theme: "aurora", mode: "dark", contrast: false });
const LIGHT = resolvePalette({ theme: "aurora", mode: "light", contrast: false });

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

test("a mid-tone that clears 3:1 but can't carry readable text fails, as the client page would fall back", () => {
  const mid = "#767676";
  for (const palette of [DARK, LIGHT]) {
    expect(Math.min(contrastRatio(mid, palette.bg), contrastRatio(mid, palette.surface))).toBeGreaterThanOrEqual(MIN_ACCENT_CONTRAST);
    expect(Math.max(contrastRatio(palette.ink, mid), contrastRatio(palette.bg, mid))).toBeLessThan(MIN_TEXT_CONTRAST);
  }
  const checks = brandChecks(mid);
  expect(checks.map((check) => [check.mode, check.passes, check.problem])).toEqual([
    ["dark", false, "text"],
    ["light", false, "text"],
  ]);
});

test("a check passes exactly when the client page would use the brand colour", () => {
  for (const colour of ["#0b84c6", "#767676", "#000000", "#ffffff", "#7c3aed", "#22d3ee", "#808080"]) {
    for (const check of brandChecks(colour)) {
      const accent = brandAccent(colour, check.palette);
      expect(check.passes, `${colour} ${check.mode}`).toBe(accent.fromBrand);
      expect(check.accent).toEqual(accent);
      expect(check.problem === null).toBe(check.passes);
    }
  }
});

test("a too-faint colour is reported as faint before anything else", () => {
  const [, light] = brandChecks("#ffffff");
  expect(light?.problem).toBe("faint");
  expect(light?.accent.accent).toBe(LIGHT.primary);
});

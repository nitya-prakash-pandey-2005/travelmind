import { expect, test } from "vitest";

/**
 * Colours live in src/theme/palettes.ts (and the stylesheet generated from it). Anywhere else, a hex, rgb()
 * or hsl() literal would ignore the theme, so this check keeps them out of components, styles and helpers.
 */
const SOURCES = import.meta.glob<string>("/src/**/*.{ts,tsx,css}", { query: "?raw", import: "default", eager: true });

const ALLOWED = [
  /^\/src\/theme\/palettes\.ts$/,
  /^\/src\/styles\/themes\.generated\.css$/,
  /\/__tests__\//,
  /\.test\.tsx?$/,
  /^\/src\/test\//,
];

const COLOUR_LITERAL = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(/;

test("no colour literals outside the palettes", () => {
  const offenders: string[] = [];
  for (const [path, source] of Object.entries(SOURCES)) {
    if (ALLOWED.some((pattern) => pattern.test(path))) continue;
    source.split(/\r?\n/).forEach((line, index) => {
      if (COLOUR_LITERAL.test(line)) offenders.push(`${path}:${index + 1}: ${line.trim()}`);
    });
  }
  expect(Object.keys(SOURCES).length).toBeGreaterThan(50);
  expect(offenders).toEqual([]);
});

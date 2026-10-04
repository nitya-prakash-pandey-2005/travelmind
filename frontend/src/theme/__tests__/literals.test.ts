import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";

/**
 * Colours live in src/theme/palettes.ts (and the stylesheet generated from it). Anywhere else, a hex, rgb()
 * or hsl() literal, a named colour (white, black, red…) or a color-mix() would sidestep the theme, so this
 * check keeps them out of components, styles and helpers. The few deliberate exceptions are listed below,
 * line by line, with the reason.
 */
const RAW = import.meta.glob<string>("/src/**/*.{ts,tsx,css}", { query: "?raw", import: "default", eager: true });
// Vitest runs with `css: false`, so a stylesheet imports as an empty string: read those from disk (the
// frontend folder is the working directory) instead.
const SOURCES: Record<string, string> = Object.fromEntries(
  Object.entries(RAW).map(([path, raw]) => [
    path,
    path.endsWith(".css") ? readFileSync(join(process.cwd(), path), "utf8") : raw,
  ]),
);

const ALLOWED_FILES = [
  /^\/src\/theme\/palettes\.ts$/,
  /^\/src\/styles\/themes\.generated\.css$/,
  /\/__tests__\//,
  /\.test\.tsx?$/,
  /^\/src\/test\//,
];

/** Lines allowed to use a flagged form: [file, a fragment of the line, why]. Each must still match a line. */
const ALLOWED_LINES: readonly [file: string, fragment: string, reason: string][] = [
  // Masks: black and transparent here are alpha stops, not colours anyone sees.
  ["/src/styles/index.css", "mask-image: radial-gradient(ellipse 70% 60% at 50% 40%, black 30%, transparent 100%);", "mask alpha"],
  ["/src/features/landing/ProductTour.tsx", "[mask-image:linear-gradient(to_bottom,black,transparent)]", "mask alpha"],
  ["/src/styles/kit/base.css", "radial-gradient(ellipse at 50% 30%, black 30%, transparent 80%)", "mask alpha (HUD grid fade)"],
  ["/src/styles/kit/components.css", "-webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);", "mask alpha (gradient edge)"],
  // Token mixes: theme tokens (or currentColor) faded towards transparent, or one token over another.
  ["/src/styles/index.css", "background: color-mix(in oklab, var(--tm-primary) 30%, transparent);", "token mix"],
  ["/src/styles/index.css", "background-color: color-mix(in oklab, currentColor var(--tm-tint-fill), transparent);", "token mix"],
  ["/src/styles/index.css", "border-color: color-mix(in oklab, currentColor var(--tm-tint-edge), transparent);", "token mix"],
  ["/src/styles/kit/components.css", "background-color: color-mix(in oklab, currentColor var(--tm-tint-fill), transparent);", "token mix (kit tones)"],
  ["/src/styles/kit/components.css", "border-color: color-mix(in oklab, currentColor var(--tm-tint-edge), transparent);", "token mix (kit tones)"],
  ["/src/styles/index.css", "background-color: color-mix(in oklab, var(--tm-brand) 18%, var(--tm-surface));", "token mix"],
  ["/src/styles/index.css", "border: 1px solid color-mix(in oklab, var(--tm-brand) 45%, transparent);", "token mix"],
  ["/src/auth/AuthFrame.tsx", "color-mix(in oklab, var(--tm-primary) 13%, transparent)", "token mix"],
  ["/src/features/landing/ClosingCall.tsx", "color-mix(in oklab, var(--tm-primary) 14%, transparent)", "token mix"],
  ["/src/features/landing/Hero.tsx", "color-mix(in oklab, var(--tm-primary) 15%, transparent)", "token mix"],
];

const NAMED =
  "(?:white|black|red|green|blue|yellow|orange|purple|violet|pink|gray|grey|silver|navy|teal|cyan|magenta|lime|maroon|olive|aqua|fuchsia|indigo|amber|emerald|rose|sky|slate|zinc|neutral|stone)";

const COLOUR_PATTERNS: readonly RegExp[] = [
  // Hex and colour functions.
  /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color-mix)\(/,
  // Tailwind's own palette: text-white, bg-black/50, border-red-500, from-sky-400…
  new RegExp(
    `(?:^|[\\s"'\`:!])(?:text|bg|border(?:-[trblxy])?|ring|ring-offset|outline|fill|stroke|from|via|to|shadow|decoration|accent|caret|divide|placeholder)-${NAMED}(?:-\\d{2,3})?(?:\\/\\d+)?(?=$|[\\s"'\`\\]])`,
  ),
  // CSS declarations and style objects: color: white; backgroundColor: "black"…
  new RegExp(
    `\\b(?:color|background(?:-color)?|backgroundColor|border(?:-[a-z]+)*-?color|borderColor|border|fill|stroke|outline(?:-color)?|outlineColor|box-shadow|boxShadow|text-shadow|textShadow|caret-color|accent-color|stop-color|stopColor)\\s*:\\s*["'\`]?[^;"'\`]*\\b${NAMED}\\b`,
  ),
  // Named colours inside gradients and shadows, wherever they are written.
  new RegExp(`\\b(?:(?:repeating-)?(?:linear|radial|conic)-gradient|drop-shadow)\\([^)]*\\b${NAMED}\\b`),
  // SVG and JSX colour attributes: fill="white", stroke={"black"}.
  new RegExp(`\\b(?:fill|stroke|stopColor|stop-color|color)=\\{?["'\`]${NAMED}["'\`]`),
];

const isColourLiteral = (line: string) => COLOUR_PATTERNS.some((pattern) => pattern.test(line));

test("the detector catches literals, named colours and color-mix, and leaves tokens and prose alone", () => {
  for (const line of [
    'className="text-white"',
    'className="bg-black/50 p-2"',
    'className="border-red-500"',
    "color: white;",
    "  background: black;",
    'style={{ color: "white" }}',
    'style={{ backgroundColor: "black" }}',
    "box-shadow: 0 0 0 1px black;",
    "background: linear-gradient(white, transparent);",
    "mask-image: linear-gradient(to bottom, black, transparent);",
    "background: color-mix(in oklab, var(--tm-primary) 30%, transparent);",
    'fill="white"',
    "color: #fff;",
    "rgb(0 0 0)",
  ]) {
    expect(isColourLiteral(line), line).toBe(true);
  }
  for (const line of [
    'className="text-ink bg-surface border-transparent"',
    'className="text-primary hover:bg-hover"',
    "/** Contrast ratio between two colours, 1 (none) to 21 (black on white). */",
    " * a cached indicative price (blue), or sandbox test inventory (amber).",
    "color: var(--tm-text);",
    "background-color: currentColor;",
    'tagline: "Black, white and yellow"',
    "const grey = tone;",
  ]) {
    expect(isColourLiteral(line), line).toBe(false);
  }
});

test("no colour literals outside the palettes", () => {
  const offenders: string[] = [];
  const used = new Set<number>();
  for (const [path, source] of Object.entries(SOURCES)) {
    if (ALLOWED_FILES.some((pattern) => pattern.test(path))) continue;
    source.split(/\r?\n/).forEach((line, index) => {
      if (!isColourLiteral(line)) return;
      const allowed = ALLOWED_LINES.findIndex(([file, fragment]) => file === path && line.includes(fragment));
      if (allowed >= 0) used.add(allowed);
      else offenders.push(`${path}:${index + 1}: ${line.trim()}`);
    });
  }
  expect(Object.keys(SOURCES).length).toBeGreaterThan(50);
  expect(SOURCES["/src/styles/index.css"]?.length ?? 0).toBeGreaterThan(1000);
  expect(offenders).toEqual([]);
  // A stale exception (the line changed or went away) is removed, not left to excuse something else.
  expect(ALLOWED_LINES.filter((_, index) => !used.has(index)).map(([file, fragment]) => `${file}: ${fragment}`)).toEqual([]);
});

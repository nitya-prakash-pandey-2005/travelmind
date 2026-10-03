import { ALL_CHOICES, resolvePalette, THEMES, TOKEN_VARS } from "./palettes";
import { DEFAULT_CHOICE, LEGACY_STORAGE_KEY, STORAGE_KEY } from "./storage";
import type { PaletteToken, ThemeChoice } from "./types";

function declarations(choice: ThemeChoice): string {
  const palette = resolvePalette(choice);
  const lines = (Object.keys(TOKEN_VARS) as PaletteToken[]).map((token) => `  ${TOKEN_VARS[token]}: ${palette[token]};`);
  return [`  color-scheme: ${choice.mode};`, ...lines].join("\n");
}

function selector(choice: ThemeChoice): string {
  const toggle = THEMES.find((theme) => theme.id === choice.theme)?.modes === "toggle";
  return toggle
    ? `:root[data-theme="${choice.theme}"][data-mode="${choice.mode}"][data-contrast="${choice.contrast ? "high" : "normal"}"]`
    : `:root[data-theme="${choice.theme}"]`;
}

/**
 * The stylesheet behind `src/styles/themes.generated.css`: a default `:root` block (Orbital dark, used when
 * scripts are off or the attribute is unknown) and one block per look keyed off the <html> data attributes.
 * Colours are in CSS, so the first paint needs no JavaScript beyond the attribute-setting pre-paint script.
 */
export function buildThemeCss(): string {
  const header = [
    "/*",
    " * GENERATED from src/theme/palettes.ts by `npm run theme:css`. Do not edit by hand:",
    " * the theme tests fail when this file and the palettes disagree.",
    " */",
  ].join("\n");
  const blocks = [`:root {\n${declarations(DEFAULT_CHOICE)}\n}`];
  for (const choice of ALL_CHOICES) blocks.push(`${selector(choice)} {\n${declarations(choice)}\n}`);
  return `${header}\n${blocks.join("\n\n")}\n`;
}

const fixedModes = Object.fromEntries(
  THEMES.filter((theme) => theme.modes !== "toggle").map((theme) => [theme.id, theme.modes === "fixed-light" ? "light" : "dark"]),
);

/**
 * Inline <head> script (copied verbatim into index.html; a test keeps them in step). It runs before the first
 * paint: reads the saved choice (or the v2 "daylight" value), coerces fixed themes, sets the three data
 * attributes and the colour scheme. Anything unexpected, including blocked storage, leaves the Orbital dark default in place.
 */
export const PREPAINT_SCRIPT =
  "(function(){var d=document.documentElement,t=" +
  JSON.stringify(THEMES.map((theme) => theme.id)) +
  ",f=" +
  JSON.stringify(fixedModes) +
  ",c=" +
  JSON.stringify(DEFAULT_CHOICE) +
  ";try{var s=window.localStorage;if(s.getItem(" +
  JSON.stringify(LEGACY_STORAGE_KEY) +
  ')==="daylight")c.mode="light";var v=JSON.parse(s.getItem(' +
  JSON.stringify(STORAGE_KEY) +
  ')||"null");if(v&&t.indexOf(v.theme)>=0)c={theme:v.theme,mode:v.mode==="light"?"light":"dark",contrast:v.contrast===true}}catch(e){}' +
  'if(f[c.theme]){c.mode=f[c.theme];c.contrast=false}d.setAttribute("data-theme",c.theme);d.setAttribute("data-mode",c.mode);d.setAttribute("data-contrast",c.contrast?"high":"normal");d.style.colorScheme=c.mode})()';

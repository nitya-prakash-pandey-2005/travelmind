import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import indexHtml from "../../../index.html?raw";
import { buildThemeCss, PREPAINT_SCRIPT } from "../css";
import { ALL_CHOICES, resolvePalette, TOKEN_VARS } from "../palettes";
import { LEGACY_STORAGE_KEY, STORAGE_KEY } from "../storage";

describe("generated theme stylesheet", () => {
  // The committed stylesheet is generated from palettes.ts; regenerate with `npm run theme:css`.
  test("src/styles/themes.generated.css is up to date", async () => {
    await expect(buildThemeCss()).toMatchFileSnapshot("../../styles/themes.generated.css");
  });

  test("the bare :root (no script, unknown theme) is Aurora dark", () => {
    const css = buildThemeCss();
    const root = css.slice(css.indexOf(":root {"), css.indexOf("}", css.indexOf(":root {")));
    expect(root).toContain(`--tm-bg: ${resolvePalette({ theme: "aurora", mode: "dark", contrast: false }).bg};`);
    expect(root).toContain("color-scheme: dark;");
  });

  test("one block per look, carrying every token", () => {
    const css = buildThemeCss();
    for (const choice of ALL_CHOICES) {
      const selector =
        ["aurora", "ocean", "ember", "forest"].includes(choice.theme)
          ? `:root[data-theme="${choice.theme}"][data-mode="${choice.mode}"][data-contrast="${choice.contrast ? "high" : "normal"}"]`
          : `:root[data-theme="${choice.theme}"]`;
      const start = css.indexOf(`${selector} {`);
      expect(start, selector).toBeGreaterThanOrEqual(0);
      const block = css.slice(start, css.indexOf("}", start));
      const palette = resolvePalette(choice);
      for (const [token, name] of Object.entries(TOKEN_VARS)) {
        expect(block, `${selector} ${name}`).toContain(`${name}: ${palette[token as keyof typeof palette]};`);
      }
      expect(block).toContain(`color-scheme: ${choice.mode};`);
    }
  });
});

describe("pre-paint script", () => {
  const html = document.documentElement;

  function runPrepaint() {
    new Function(PREPAINT_SCRIPT)();
    return { theme: html.dataset.theme, mode: html.dataset.mode, contrast: html.dataset.contrast };
  }

  beforeEach(() => {
    window.localStorage.clear();
    for (const name of ["data-theme", "data-mode", "data-contrast"]) html.removeAttribute(name);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("is inlined in index.html, ahead of any stylesheet or module script", () => {
    const tag = `<script>${PREPAINT_SCRIPT}</script>`;
    expect(indexHtml).toContain(tag);
    const at = indexHtml.indexOf(tag);
    expect(at).toBeLessThan(indexHtml.indexOf('<script type="module"'));
    expect(at).toBeLessThan(indexHtml.indexOf("</head>"));
    // The markup itself also carries the default look, for when scripts are off.
    expect(indexHtml).toMatch(/<html lang="en" data-theme="aurora" data-mode="dark" data-contrast="normal">/);
  });

  test("stays tiny", () => {
    expect(PREPAINT_SCRIPT.length).toBeLessThan(800);
  });

  test("applies a saved choice, including the colour scheme", () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ theme: "ocean", mode: "light", contrast: true }));
    expect(runPrepaint()).toEqual({ theme: "ocean", mode: "light", contrast: "high" });
    expect(html.style.colorScheme).toBe("light");
  });

  test("coerces fixed themes", () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ theme: "contrast", mode: "light", contrast: true }));
    expect(runPrepaint()).toEqual({ theme: "contrast", mode: "dark", contrast: "normal" });
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ theme: "clearsky", mode: "dark", contrast: false }));
    expect(runPrepaint()).toEqual({ theme: "clearsky", mode: "light", contrast: "normal" });
  });

  test("honours the old daylight value", () => {
    window.localStorage.setItem(LEGACY_STORAGE_KEY, "daylight");
    expect(runPrepaint()).toEqual({ theme: "aurora", mode: "light", contrast: "normal" });
  });

  test("moves retired themes to their replacements, as the store does", () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ theme: "orbital", mode: "light", contrast: true }));
    expect(runPrepaint()).toEqual({ theme: "aurora", mode: "light", contrast: "high" });
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ theme: "nebula", mode: "dark", contrast: false }));
    expect(runPrepaint()).toEqual({ theme: "aurora", mode: "dark", contrast: "normal" });
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ theme: "terminal", mode: "light", contrast: false }));
    expect(runPrepaint()).toEqual({ theme: "forest", mode: "dark", contrast: "normal" });
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ theme: "ember", mode: "light", contrast: false }));
    expect(runPrepaint()).toEqual({ theme: "ember", mode: "light", contrast: "normal" });
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ theme: "toString" }));
    expect(runPrepaint()).toEqual({ theme: "aurora", mode: "dark", contrast: "normal" });
  });

  test("falls back to Aurora dark for junk, nothing saved, or blocked storage", () => {
    expect(runPrepaint()).toEqual({ theme: "aurora", mode: "dark", contrast: "normal" });
    window.localStorage.setItem(STORAGE_KEY, "{oops");
    expect(runPrepaint()).toEqual({ theme: "aurora", mode: "dark", contrast: "normal" });
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ theme: "neon" }));
    expect(runPrepaint()).toEqual({ theme: "aurora", mode: "dark", contrast: "normal" });
    vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    expect(runPrepaint()).toEqual({ theme: "aurora", mode: "dark", contrast: "normal" });
  });
});

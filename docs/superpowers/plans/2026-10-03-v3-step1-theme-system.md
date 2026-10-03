# v3 · Step 1 — Theme System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Six original themes (Orbital, Nebula, Ember, Clearsky, Terminal, Contrast) with light/dark and high-contrast variants, a keyboard-accessible switcher, no flash on load, and charts/globe that recolour live.

**Architecture:** One theme module (`frontend/src/theme/`) defines palettes as data; a token applier writes CSS custom properties for the chosen `{theme, mode, contrast}` onto `<html>` and the existing Tailwind theme tokens read those properties; an inline head script applies the saved choice before first paint; React context exposes the choice and a palette export for canvas/WebGL.

**Tech Stack:** React 19, TypeScript, Tailwind 4 `@theme inline`, `@fontsource` packages, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-03-travelmind-platform-v3-design.md` §2 (binding palettes, modes, extras, fonts, persistence, tests).

## Global Constraints
- No colour literals outside `frontend/src/theme/palettes.ts` and `frontend/src/styles/theme.css` fallbacks; components use tokens only.
- Body text ≥ 4.5:1 and large text/UI ≥ 3:1 against its background in every theme × mode × contrast (automated check).
- `prefers-reduced-motion` disables flicker/glow animation; Terminal scanlines are static.
- Fonts self-hosted via `@fontsource` / `@fontsource-variable`; no third-party CDN.
- Storage key `tm.theme` = `{"theme":"orbital","mode":"dark","contrast":false}`; migrate the old `tm-theme` key (`dark`→orbital dark, `daylight`→orbital light); every storage access wrapped in try/catch.
- No AI/assistant attribution anywhere; plain conventional commits; low memory: focused test runs; local lint blocked (CI lints).

## Review Focus
1. Flash of wrong theme on first paint (inline script must run before CSS paints; works when storage is blocked).
2. Contrast regressions in any combination (automated AA test over every combo).
3. Fixed themes (Clearsky/Terminal/Contrast) must disable and ignore mode/contrast toggles.
4. Charts/globe must read the live palette after a switch (no stale colours).
5. Keyboard: the switcher opens, moves, selects and closes with keys; focus returns to the trigger.

---

### Task 1: Theme core — palettes, tokens, persistence, first paint
**Files:** create `frontend/src/theme/{palettes.ts,types.ts,applyTheme.ts,storage.ts,ThemeProvider.tsx,useThemePalette.ts,contrast.ts,index.ts}`, `frontend/src/theme/__tests__/{palettes.test.ts,contrast.test.ts,storage.test.ts,provider.test.tsx}`; modify `frontend/index.html` (inline pre-paint script generated from the same data — keep it tiny: read `tm.theme`, set `data-theme/data-mode/data-contrast` and the CSS variables block id), `frontend/src/styles/theme.css` (tokens read `var(--tm-*)` custom properties set per `[data-theme]` blocks generated from palettes, or written by `applyTheme` — choose CSS blocks generated at build time via a small script so first paint needs no JS for colours; the inline script only sets attributes), `frontend/src/styles/index.css` (theme extras: glow titles, Ember title gradient, Terminal scanlines/vignette/flicker, Contrast no-effects, focus ring per theme), `frontend/src/ui/theme.ts` + `ThemeToggle.tsx` (replace the old dark/daylight store with the provider; keep `useTheme()` API compatible or update callers), `frontend/src/app/AppProviders.tsx`, fonts (`npm install @fontsource-variable/sora @fontsource/fraunces @fontsource/ibm-plex-mono` — Inter/JetBrains Mono already present).
**Contracts:** `type ThemeId = "orbital"|"nebula"|"ember"|"clearsky"|"terminal"|"contrast"`; `type ThemeChoice = {theme: ThemeId; mode: "dark"|"light"; contrast: boolean}`; `THEMES: ThemeMeta[]` (`id,name,tagline,swatch:[4 hex],modes: "toggle"|"fixed-light"|"fixed-dark"`); `resolvePalette(choice) -> Palette` (all token keys); `ThemeProvider` + `useThemeChoice() -> [choice, setChoice]`; `useThemePalette() -> Palette` (re-renders on change); `contrastRatio(hexA, hexB)`.
**Tests:** every palette has every token; every combo passes the AA checks for ink/dim/primary-on-bg/ink-on-surface/primary-ink-on-primary; storage migration + blocked storage; fixed themes coerce mode/contrast; provider sets html attributes; pre-paint script string parses and sets attributes for a saved value (jsdom).
**Commit:** `feat(theme): six themes with light, dark and high-contrast variants`

### Task 2: Switcher UI, extras and live chart/globe colours
**Files:** create `frontend/src/theme/ThemeSwitcher.tsx` (+ test); modify `frontend/src/shell/TopBar.tsx` (switcher in the top bar; compact entry in the user menu on phones), landing/auth headers (switcher available on public pages), `frontend/src/ui/charts/*` + `frontend/src/features/globe/*` (read colours via `useThemePalette()` where they use canvas/WebGL or computed colours), `frontend/src/ui/DesignGallery.tsx` (theme preview grid: every theme's swatches + sample components).
**Contracts:** switcher button "Theme: Orbital" opens a listbox/menu of six options (name, tagline, swatch) with Arrow/Home/End/Enter/Esc; mode segmented control (Dark/Light) and "High contrast" switch shown under the list, disabled with a note for fixed themes; selection applies instantly and persists.
**Tests:** keyboard flow; fixed themes disable toggles; persistence across remount; charts receive new palette after switch (render a chart, switch, assert colour prop/attribute changes); smoke: render landing, Command Center, Fare search in every theme without errors.
**Visual QA:** screenshots of landing + Command Center in all six themes (dark and light where available) via the mocked Playwright script (`frontend/shots-app.tmp.mjs` pattern, installed Chrome); fix anything unreadable.
**Commit:** `feat(theme): theme switcher with live chart and globe colours`

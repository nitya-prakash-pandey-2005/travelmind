# TravelMind — Design Direction v2 ("Operations Console")

Status: approved direction for the UI overhaul (replaces the v1 "Mission Control" styling). Owner feedback on v1: looked childish and amateur, text not good, not professional, sci-fi feel missing; must look like a standard industry application.

## 1. Positioning

TravelMind should look like serious operations software that a travel management company would pay for — in the family of **Linear, Vercel, Datadog, Stripe Dashboard, Palantir Foundry, Anduril Lattice, Bloomberg Terminal**. The sci-fi feeling comes from *precision*: dense telemetry, monospaced readouts, live status indicators, crisp hairlines, a restrained single accent — never from neon glow, scanlines, gamer fonts, all-caps shouting, or decoration.

Principles:
1. **Calm and dense.** Information first; chrome recedes. Small type, tight rhythm, lots of data on screen, no giant empty hero blocks inside the app.
2. **One accent.** Cyan is reserved for primary actions, focus, the active nav item and live signals. Everything else is neutral graphite.
3. **Status by colour, meaning by text.** Green/amber/red/blue/violet only for status, always with a label.
4. **Telemetry, not theatre.** Mono numerals, units, timestamps, "live" dots, latency in ms, sparklines — real data only.
5. **Consistency beats flourish.** Every page uses the same page header, card, table, form and empty-state patterns.

## 2. Tokens

### Colour — dark (default)
| Token | Value | Use |
|---|---|---|
| `--tm-bg` (void) | `#0A0C10` | App background |
| `--tm-surface` (deck) | `#0F1217` | Cards, sidebar, top bar |
| `--tm-surface-2` (raised) | `#151920` | Hover rows, inputs, nested panels |
| `--tm-border` (line) | `#222833` | 1px hairlines |
| `--tm-border-strong` | `#2E3542` | Input borders, dividers that need weight |
| `--tm-text` (ink) | `#E7EAF0` | Primary text |
| `--tm-text-2` (dim) | `#9AA3B2` | Secondary text |
| `--tm-text-3` | `#6B7385` | Tertiary text, placeholders (not for essential info) |
| `--tm-primary` | `#3CC6F0` | Primary actions, focus, active |
| `--tm-primary-ink` | `#04121A` | Text on primary |
| `--tm-ok` | `#34C38F` | Success / live / verified |
| `--tm-warn` | `#F0B429` | Warnings, policy, sandbox |
| `--tm-danger` | `#F0555A` | Errors, destructive |
| `--tm-info` | `#6A9CFF` | Neutral info |
| `--tm-ai` | `#9B8AFB` | AI / Copilot only (violet, replaces magenta) |
| chart 1–6 | `#3CC6F0 #9B8AFB #F0B429 #34C38F #F0555A #6A9CFF` | Categorical |

### Colour — light ("daylight", equally polished)
bg `#F6F7F9`, surface `#FFFFFF`, surface-2 `#F1F3F6`, border `#E3E6EB`, border-strong `#CDD2DA`, text `#0E131B`, text-2 `#4B5566`, text-3 `#707A8C`, primary `#0B84C6`, primary-ink `#FFFFFF`, ok `#15803D`, warn `#B45309`, danger `#C81E1E`, info `#2F5FD0`, ai `#6D4AE0`, charts `#0B84C6 #6D4AE0 #B45309 #15803D #C81E1E #2F5FD0`. All text pairs ≥ 4.5:1.

### Typography
- **UI font: Inter** (variable; `@fontsource-variable/inter`), with `font-feature-settings: "cv11", "ss01"`; tabular numbers where numbers align (`font-variant-numeric: tabular-nums`).
- **Data font: JetBrains Mono** for prices, codes (IATA, flight numbers, E-0007/Q-0004), timestamps, latencies, KPI values.
- **Chakra Petch is removed** from the product UI. (The wordmark uses Inter 600 with slight letter-spacing.)
- Scale (px / line-height / weight): `11/16 medium` micro-label (uppercase, tracking 0.06em, text-3) · `12/16` caption · `13/20` body-sm (tables, sidebar) · `14/20` body (default) · `16/24` emphasis · `18/26 semibold` section title · `22/28 semibold` page title (tracking -0.01em) · `28/34` KPI value (mono) · landing only: `44–56/1.05 semibold` hero (tracking -0.02em).
- **Sentence case everywhere** (buttons, headings, nav). No all-caps except micro-labels and status pills.

### Space, radius, elevation
- 4px base grid; common gaps 8/12/16/24; page padding 24px desktop, 16px mobile.
- Radius: 6px controls, 8px cards/panels, 999px pills. (No 2px square HUD corners.)
- Borders: 1px `--tm-border`; cards have no glow. Elevation only for popovers/dialogs: `0 8px 24px -8px rgb(0 0 0 / .5)` (dark), softer in light.
- Motion: 120–180 ms ease-out; no looping animations except a 2 s pulse on "live" dots; all off under reduced motion.

### Sci-fi touches (allowed, tasteful)
- Faint dot-grid (`radial-gradient` 1px dots, 24px spacing, ~4% opacity) behind the landing hero and the Command Center page header only.
- Live status dots with subtle pulse; "LIVE / CACHED / SANDBOX" provenance pills in mono micro type.
- Telemetry strip in the status bar: API latency, suppliers online, UTC + agency clock, build/version.
- Route globe kept, restyled: thin 1px arcs, muted land, no heavy glow.
- Optional 4 tiny corner ticks on the *hero globe frame only*.
- **Removed:** scanlines, glow shadows on buttons, gradient text, neon magenta, bracket corners on every panel, "tm-blink" text, gamer display font.

## 3. Layout patterns

- **App frame:** 48px top bar (workspace switcher with agency mark + name, global search field "Search clients, enquiries, quotes…  Ctrl K", notifications, help, user avatar menu) · 240px sidebar (collapsible to 56px) with section labels (micro-label), 32px items, 16px icons, active item = surface-2 background + 2px left accent bar + text ink · 28px status bar (telemetry).
- **Page header:** breadcrumb (caption, text-3) → title (22px semibold) + one-line description (13px text-2) on the left; actions on the right (secondary buttons, then one primary). Optional tabs row beneath with a bottom border.
- **Cards/panels:** header row (16px semibold title + optional caption + actions), body, optional footer link ("View all →"). Consistent 16px padding.
- **KPI tiles:** micro-label, value (28px mono), delta chip (↑ 12.4% vs prev. 30 days, coloured by good/bad), sparkline 32px; tiles in a single bordered strip with dividers (like Vercel/Datadog), not separate glowing boxes.
- **Tables:** 36px rows, 13px text, sticky header on surface, subtle zebra-free hover, right-aligned mono numbers, status pills, row actions on hover (and keyboard).
- **Forms:** labels above inputs (13px medium), inputs 36px, helper text 12px text-2, errors 12px danger with icon; primary button right-aligned in dialogs.
- **Empty states:** icon in a 40px rounded square, 14px semibold title, 13px text-2 one-liner, one primary action. Never lorem-ish filler.
- **Buttons:** primary (accent fill), secondary (surface-2 + border), ghost (text only), danger; heights 32 (sm) / 36 (md); sentence case; icon + label where it helps.

## 4. Copy style guide (the text)

- Plain, confident B2B English. Short. No puns, no space/mission jokes in functional UI.
- Buttons are verbs: "Scan fares", "Create enquiry", "Send quote", "Invite teammate", "Sign in", "Create workspace".
- Headings name the thing: "Command Center" (product area name stays), "Pipeline", "Quotes", "Clients", "Fare search", "Hotel search", "Suppliers", "Team", "Settings".
- Rename v1 flavour text: "Crew roster" → "Team"; "Mission access" → "Sign in to TravelMind"; "Create command deck" → "Create workspace"; "Engage" → "Sign in"; "Join the crew" → "Join workspace"; "Signal lost" → "Page not found"; "Return to Command Center" link stays; "Fare scan" nav → "Fare search"; "Hotel scan" → "Hotel search"; "Plot a route" → "Route planner"; "Scanning suppliers…" → "Searching suppliers…"; "Supplier sweep" → "Supplier status"; "Fare board" → "Results"; "Price check" → "Fare insight".
- Numbers always with units and context ("₹6.2L pipeline · 12 open quotes"); timestamps relative in lists ("5 min ago"), absolute in details ("30 Sep 2026, 14:05 IST").
- Error messages: what happened + what to do ("Couldn't reach Duffel. Showing results from other suppliers.").
- Landing copy: specific, credible, no hype words ("revolutionary", "AI-powered magic"); lead with the job ("Quote faster with every fare explained").

## 5. Accessibility & quality bar
WCAG AA both themes; visible focus ring (2px accent, 2px offset); keyboard for everything; 375 px without horizontal scroll; `prefers-reduced-motion` respected; charts keep their text alternatives; no layout shift from late data (skeletons sized like content).

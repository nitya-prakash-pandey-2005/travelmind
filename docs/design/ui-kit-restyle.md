# UI kit restyle: inventory and approach

Date: 2026-10-05. Source kit: `D:\Hackathons\ui-kit` (DESIGN.md). Default theme: **aurora**.

## Rule
Keep every page, feature, route, API call, form field and piece of user-facing text. Change only the presentation (layout, components, styles).

## Pages and features (must all survive)

### Public
| Route | Page | Features |
|---|---|---|
| `/` | Landing | Header nav (Product, Features, How it works, Security, FAQ), Sign in, Create workspace, theme switcher; hero with product preview (Command Center window, fare insight, supplier status); live platform facts (airports, routes); fare console preview with plotted route; features grid; how it works; product tour screens; security; integrations ("Connects to"); FAQ; closing call; footer with theme toggle |
| `/demo` | Demo launch | Creates a private demo workspace with sample data, progress steps, redirects into the app |
| `/login` | Sign in | Email, password, errors, redirect, link to sign up; product panel (pitch, fare console, data sources) |
| `/signup` | Create workspace | Agency name, country (IN/US), name, email, password, validation |
| `/invite/$token` | Accept invitation | Name, password, joins workspace |
| `/q/$token` | Client quote page | Agency brand colour, greeting, agent message, option cards (itinerary, baggage, refund/change, CO₂, price label, totals), accept with confirm, decline, expired/invalid/decided/rate-limited states, print layout, theme switcher |

### App shell (`/app/*`)
Top bar (agency name + demo badge, global search / command palette Ctrl K, theme switcher, notifications bell, help menu, user menu with theme entry and sign out), sidebar (Operate: Command Center, Pipeline, Quotes, Clients, Agent · Market: Fare search, Hotel search, Route intel · Admin: Team, Suppliers, Settings, Design system; collapsible to an icon rail), demo banner with Exit demo, status bar (API online + latency, suppliers connected, UTC/IST clocks), skip link, phone navigation drawer.

| Route | Page | Features |
|---|---|---|
| `/app` | Command Center | Greeting, range 7d/30d/90d, New enquiry dialog, onboarding checklist (Get set up), KPI strip (open enquiries, quotes sent, win rate, pipeline value, response time, CO₂ quoted, searches) with sparklines, activity trend chart, pipeline by stage, route map globe (rotate/zoom/hover countries, flying planes, busiest routes), market pulse, supplier health, team panel, activity feed |
| `/app/pipeline` | Pipeline | KPI strip, filters (search, assignee, route), board/list toggle, 5 stage columns with count/value/avg age, drag and drop + keyboard Move menu, Lost reason dialog, phone stage picker |
| `/app/enquiries/$id` | Enquiry | Header facts, Move, Edit drawer, Scan fares link, Create quote dialog, Plan with agent, KPI strip, Trip, Quotes table, Details, Timeline |
| `/app/quotes` | Quotes | KPIs, status tabs with server counts, search, table / phone row list, New quote dialog (markup kind + value) |
| `/app/quotes/$id` | Quote editor | Header + status actions (record outcome), KPIs, Find offers (search, selectable offer cards, currency gating), builder (markup, per-option overrides, message, Re-price and save, Save version), version history + preview, send dialog (link, copy, WhatsApp text, re-send warning), trip, timeline |
| `/app/clients` | Clients | KPIs, search, tag filter, table / row list, New client drawer |
| `/app/clients/$id` | Client | Header (kind, tags), contact card (mailto/tel), KPIs (last/next trip, won value), enquiries, quotes, timeline, edit drawer, delete (409 inline), new enquiry prefilled |
| `/app/agent`, `/app/agent/$runId` | Agent | Composer (2000 chars, suggestions), run list, live trace (SSE, resume, polling fallback), questions, confirm card (warnings), plan board (verified badge, flights, hotels, places, weather, itinerary, budget / price comparison, globe), telemetry, overview (how it works, status, data sources), phone Conversation/Plan switch |
| `/app/fares` | Fare search | Search form (airport pickers, dates, adults, children ages, cabin), prefill from URL, results with provenance, fare insight, CO₂, verify price, sorting, supplier status, route planner |
| `/app/hotels` | Hotel search | Form, results, supplier status |
| `/app/routes` | Route intel | Route picker + swap + cabin, family badge, KPIs, trend with p25–p75 band, days-out bars, carriers table, your searches, suggestions, empty state |
| `/app/team` | Team | Members table, invite dialog (link once), roles panel |
| `/app/suppliers` | Suppliers | Booking suppliers + data services with status, breaker, latency |
| `/app/settings` | Settings | Agency profile form, time zone, brand colour picker with preview and contrast gate, workspace/team/appearance/privacy panels, demo/agent read-only |
| `/app/design` | Design system | Component gallery, theme preview grid |

Cross-cutting: command palette, toasts, theme system (switcher, persistence, pre-paint script, charts and globe recolour), reduced motion, keyboard access, plain-text rendering of model/supplier text.

## Approach
- **Kit foundation:**
  - The kit's `styles/*.css` (tokens, base, components, layout) and fonts (Space Grotesk, Inter, JetBrains Mono) come into the project.
  - Its React components are ported to TypeScript where they fit (Card/Hud/Stat/Gauge/charts/Sheet).
- **Themes:** the kit themes **aurora** (default), ocean, ember and forest become the app's dark themes. The light (Clearsky) and high-contrast (Contrast) looks are kept for accessibility. Every colour still flows through tokens; the AA contrast tests still run.
- **Shell:** the kit layout. On desktop above 900 px, a sidebar with brand glow, HUD group labels and gradient active state. On phones, a top bar plus a bottom tab bar (5 tabs: Command, Pipeline, Agent, Quotes, More), with a More sheet for the rest. The top-bar tools and the status bar stay.
- **Visual language:** glass cards (22 px radius, blur), HUD mono labels, gradient primary buttons, kit badges and tones, Stat tiles, ambient glow and HUD grid background, Space Grotesk headings.
- **Deviation from DESIGN.md:** the project keeps **TanStack Router** (deep links, guards, typed params) and **Tailwind** underneath, because every page, test and link is built on them. The kit's look, tokens, layout recipes and components are applied on top. Removing them would be a rewrite with real risk to features, which the kit's own golden rule 1 forbids.

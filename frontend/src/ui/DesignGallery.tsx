import { Activity, Copy, Download, Inbox, Pencil, Plus, Radar, Send, Trash2 } from "lucide-react";
import { Avatar as KitAvatar, Badge as KitBadge, Card, Gauge, Heatmap, Hud, LineChart, MiniRing, Seg, Sheet, Spark, StackedBars, Stat, Toggle } from "../kit";
import { useState, type CSSProperties, type ReactNode } from "react";
import { resolvePalette, THEMES, TOKEN_VARS, useThemeChoice, type PaletteToken, type ThemeMeta } from "../theme";
import { ThemeSwatch } from "../theme/ThemeSwitcher";
import { Avatar, AvatarStack } from "./Avatar";
import { Badge } from "./Badge";
import { Button, buttonClasses } from "./Button";
import { AreaTrend, BarList, Donut, Funnel, KpiStrip, KpiTile, LatencyBand, type TrendSeries } from "./charts";
import { DataTable, type DataTableColumn } from "./DataTable";
import { Dialog } from "./Dialog";
import { Drawer } from "./Drawer";
import { EmptyState } from "./EmptyState";
import { Kbd } from "./Kbd";
import { Menu } from "./Menu";
import { PageHeader } from "./PageHeader";
import { Panel } from "./Panel";
import { ProvenanceBadge } from "./ProvenanceBadge";
import { Readout } from "./Readout";
import { SegmentedControl } from "./SegmentedControl";
import { SelectField } from "./SelectField";
import { PanelSkeleton, Skeleton } from "./Skeleton";
import { StatusDot } from "./StatusDot";
import { STATUS_PILL, StatusPill, type PillStatus } from "./StatusPill";
import { Tabs } from "./Tabs";
import { TextField } from "./TextField";
import { useToast } from "./toast/useToast";

const SURFACE_TOKENS = ["--tm-bg", "--tm-surface", "--tm-surface-2", "--tm-border", "--tm-border-strong"];
const TEXT_TOKENS = ["--tm-text", "--tm-text-2", "--tm-text-3", "--tm-primary"];
const STATUS_TOKENS = ["--tm-ok", "--tm-warn", "--tm-danger", "--tm-info", "--tm-ai"];
const CHART_TOKENS = ["--tm-chart-1", "--tm-chart-2", "--tm-chart-3", "--tm-chart-4", "--tm-chart-5", "--tm-chart-6"];

const TYPE_SCALE: ReadonlyArray<{ name: string; spec: string; className: string; sample: string }> = [
  { name: "Page title", spec: "28 Space Grotesk", className: "tm-page-title", sample: "Pipeline" },
  { name: "Section title", spec: "18/26 Space Grotesk", className: "font-display text-lg font-semibold leading-[26px]", sample: "Open quotes" },
  { name: "Emphasis", spec: "16/24", className: "text-base", sample: "Quote faster with every fare explained" },
  { name: "Body", spec: "14/20", className: "text-sm", sample: "Every price is labelled with where it came from." },
  { name: "Body small", spec: "13/20", className: "text-[13px] leading-5", sample: "Tables, the sidebar and dense lists." },
  { name: "Caption", spec: "12/16", className: "text-xs text-dim", sample: "Updated 5 min ago" },
  { name: "HUD label", spec: "10.5 mono caps", className: "tm-micro", sample: "Suppliers" },
  { name: "KPI value", spec: "30 Space Grotesk", className: "num text-[30px] font-semibold leading-[38px]", sample: "₹6.2L" },
  { name: "Data", spec: "13/20 mono", className: "font-mono text-[13px] leading-5", sample: "DEL → BOM · AI 865 · Q-0004 · 14:05 IST" },
];

// Illustrative specimen rows for the style guide only; never shown as product data.
type SpecimenRow = { id: string; ref: string; client: string; route: string; travellers: number; status: PillStatus };
const SPECIMEN_ROWS: SpecimenRow[] = [
  { id: "1", ref: "E-0012", client: "Sample Client A", route: "DEL → BOM", travellers: 2, status: "quoting" },
  { id: "2", ref: "E-0009", client: "Sample Client B", route: "BLR → DXB", travellers: 4, status: "won" },
  { id: "3", ref: "E-0010", client: "Sample Client C", route: "BOM → SIN", travellers: 1, status: "new" },
];
const SPECIMEN_COLUMNS: DataTableColumn<SpecimenRow>[] = [
  { key: "ref", header: "Enquiry", cell: (r) => <span className="font-mono">{r.ref}</span>, sortValue: (r) => r.ref },
  { key: "client", header: "Client", cell: (r) => r.client, sortValue: (r) => r.client },
  { key: "route", header: "Route", cell: (r) => <span className="font-mono">{r.route}</span> },
  { key: "travellers", header: "Pax", cell: (r) => r.travellers, sortValue: (r) => r.travellers, align: "right" },
  { key: "status", header: "Status", cell: (r) => <StatusPill status={r.status} /> },
];

// Chart specimens: small inline shapes for the component showcase only; never product data.
const SPECIMEN_DAYS = Array.from({ length: 14 }, (_, i) => `2026-09-${String(i + 1).padStart(2, "0")}`);
const SPECIMEN_TREND: TrendSeries[] = [
  { key: "a", label: "Series A", color: 1, points: SPECIMEN_DAYS.map((date, i) => ({ date, value: 6 + ((i * 7) % 9) + i })) },
  { key: "b", label: "Series B", color: 2, points: SPECIMEN_DAYS.map((date, i) => ({ date, value: 2 + ((i * 5) % 6) + Math.floor(i / 2) })) },
];
const SPECIMEN_SPARK = [3, 5, 4, 6, 8, 7, 9];

const RANGES = [
  { value: "7d", label: "7d" },
  { value: "30d", label: "30d" },
  { value: "90d", label: "90d" },
] as const;

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="grid min-w-0 gap-4 border-t border-line pt-6 lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-8">
      <div>
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
        {description && <p className="mt-1 text-xs leading-4 text-dim">{description}</p>}
      </div>
      <div className="flex min-w-0 flex-col gap-4">{children}</div>
    </section>
  );
}

function Swatches({ tokens }: { tokens: string[] }) {
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
      {tokens.map((token) => (
        <li key={token} className="flex min-w-0 flex-col gap-1.5">
          <span className="h-10 rounded-md border border-line" style={{ background: `var(${token})` }} />
          <code className="truncate font-mono text-[11px] text-dim">{token}</code>
        </li>
      ))}
    </ul>
  );
}

function OverlayDemo() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const { toast } = useToast();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="secondary" onClick={() => setDialogOpen(true)}>
        Open dialog
      </Button>
      <Button variant="secondary" onClick={() => setDrawerOpen(true)}>
        Open drawer
      </Button>
      <Menu
        trigger="Actions"
        items={[
          { label: "Edit", icon: Pencil, onSelect: () => toast({ tone: "info", title: "Edit selected" }) },
          { label: "Duplicate", icon: Copy, onSelect: () => toast({ tone: "info", title: "Duplicate selected" }) },
          { label: "Delete", icon: Trash2, danger: true, separated: true, onSelect: () => toast({ tone: "danger", title: "Delete selected" }) },
        ]}
      />
      <Button variant="ghost" onClick={() => toast({ tone: "ok", title: "Quote sent", description: "Q-0004 is with the client." })}>
        Toast: success
      </Button>
      <Button variant="ghost" onClick={() => toast({ tone: "warn", title: "Rate limited", description: "Try again in a minute." })}>
        Toast: warning
      </Button>
      <Button variant="ghost" onClick={() => toast({ tone: "danger", title: "Couldn't send the quote" })}>
        Toast: error
      </Button>
      <Dialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        title="Send quote"
        description="The client gets a link to view and accept it."
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={() => setDialogOpen(false)}>
              <Send size={14} aria-hidden="true" /> Send quote
            </Button>
          </>
        }
      >
        <TextField label="Client email" placeholder="name@company.com" data-autofocus="" />
      </Dialog>
      <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)} title="Record details" description="Side panel for a record.">
        <dl className="grid grid-cols-2 gap-4">
          <Readout label="Label" value="Value" />
          <Readout label="Metric" value="42" unit="pts" />
        </dl>
      </Drawer>
    </div>
  );
}

/** Living style guide for the operations-console design language (design direction v2). */
/** Every token of a theme's default look as inline custom properties, so a card renders in that theme. */
function themeScope(theme: ThemeMeta): CSSProperties {
  const palette = resolvePalette({ theme: theme.id, mode: theme.modes === "fixed-light" ? "light" : "dark", contrast: false });
  const scope: Record<string, string> = {};
  for (const token of Object.keys(TOKEN_VARS) as PaletteToken[]) scope[TOKEN_VARS[token]] = palette[token];
  return scope as CSSProperties;
}

const MODES_NOTE: Record<ThemeMeta["modes"], string> = {
  toggle: "Dark, light and high contrast",
  "fixed-light": "Light only",
  "fixed-dark": "Dark only",
};

/** One card per theme, drawn in that theme's own tokens (glass, gradient and glow included), with a button that applies it. */
function ThemePreviews() {
  const [choice, setChoice] = useThemeChoice();
  return (
    <ul aria-label="Theme previews" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {THEMES.map((theme) => {
        const current = theme.id === choice.theme;
        return (
          <li
            key={theme.id}
            data-theme-scope=""
            style={themeScope(theme)}
            className="relative isolate flex min-w-0 flex-col overflow-hidden rounded-[22px] border border-line bg-bg font-sans text-ink"
          >
            <div aria-hidden="true" className="tm-ambient -z-10" />
            <div className="flex items-center gap-3 border-b border-line bg-chrome px-3.5 py-3">
              <ThemeSwatch theme={theme} />
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate font-display text-sm font-semibold">{theme.name}</span>
                <span className="truncate text-xs text-dim">{theme.tagline}</span>
              </div>
            </div>
            <div className="flex flex-col gap-3 p-3.5">
              <div className="card tight flex flex-col gap-1">
                <span className="tm-micro">Open quotes</span>
                <span className="num text-2xl font-semibold">₹6.2L</span>
                <span className="text-xs text-dim">12 quotes · updated 5 min ago</span>
                <div aria-hidden="true" className="mt-1 flex h-1.5 overflow-hidden rounded-full">
                  <span className="w-[38%] bg-chart-1" />
                  <span className="w-[22%] bg-chart-2" />
                  <span className="w-[16%] bg-chart-3" />
                  <span className="w-[14%] bg-chart-4" />
                  <span className="w-[10%] bg-chart-5" />
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <KitBadge tone="green" dot>
                  Live
                </KitBadge>
                <KitBadge tone="amber">Cached</KitBadge>
                <span className="text-xs text-faint">{current ? "Current theme" : MODES_NOTE[theme.modes]}</span>
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" aria-pressed={current} onClick={() => setChoice({ theme: theme.id })}>
                  Use {theme.name}
                </Button>
                <span aria-hidden="true" className={buttonClasses({ variant: "secondary", size: "sm" })}>
                  Secondary
                </span>
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

// Kit specimens: illustrative shapes for the showcase only; never product data.
const KIT_DAYS = Array.from({ length: 10 }, (_, i) => `2026-09-${String(i + 1).padStart(2, "0")}`);
const KIT_LINE = KIT_DAYS.map((date, i) => ({ date, a: 4 + ((i * 5) % 7) + i / 2, b: 2 + ((i * 3) % 5) }));
const KIT_BARS = KIT_DAYS.slice(0, 7).map((date, i) => ({
  date,
  label: date.slice(8),
  total: 3 + ((i * 4) % 6) + 2,
  bySeries: { "Series A": 3 + ((i * 4) % 6), "Series B": 2 },
}));
const KIT_HEAT = [
  { id: "r1", name: "Row one", cells: KIT_DAYS.map((_, i) => (i * 3) % 13) },
  { id: "r2", name: "Row two", cells: KIT_DAYS.map((_, i) => (i === 4 ? null : (i * 5) % 11)) },
];

function KitShowcase() {
  const [seg, setSeg] = useState<"day" | "week" | "month">("week");
  const [on, setOn] = useState(true);
  const [sheetOpen, setSheetOpen] = useState(false);
  return (
    <div className="flex flex-col gap-4">
      <div className="grid g4 keep-2">
        <Card variant="tight">
          <Stat value="38" label="Stat" />
        </Card>
        <Card variant="tight">
          <Stat value="63.6" unit="%" label="Stat with unit" tone="green" />
        </Card>
        <Card variant="tight">
          <div className="flex items-center justify-between gap-2">
            <Stat value="12" label="With a spark" />
            <Spark values={[3, 5, 4, 6, 8, 7, 9]} color="var(--tm-primary)" width={80} />
          </div>
        </Card>
        <Card variant="tight">
          <div className="flex items-center gap-3">
            <MiniRing value={0.72} label="72%" />
            <Hud>Mini ring</Hud>
          </div>
        </Card>
      </div>
      <div className="grid g2">
        <Card title="Card with an icon chip" icon={Radar} right={<KitBadge tone="green" dot>Live</KitBadge>} variant="glow">
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap gap-2">
              <KitBadge tone="pink">Pink</KitBadge>
              <KitBadge tone="green">Green</KitBadge>
              <KitBadge tone="amber">Amber</KitBadge>
              <KitBadge tone="rose">Rose</KitBadge>
              <KitBadge tone="cyan">Cyan</KitBadge>
              <KitBadge tone="violet">Violet</KitBadge>
              <KitBadge>Muted</KitBadge>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Hud>HUD label</Hud>
              <Hud tone="pink">Accent</Hud>
              <Hud tone="cyan">Info</Hud>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Seg label="Specimen period" options={["day", "week", "month"] as const} value={seg} onChange={setSeg} />
              <Toggle on={on} onChange={setOn} label="Specimen toggle" />
            </div>
            <div className="flex items-center gap-2">
              <KitAvatar name="Asha Verma" size="sm" />
              <KitAvatar name="Rohan Iyer" />
              <KitAvatar name="Lena Park" size="lg" status="var(--tm-ok)" />
              <Button size="sm" variant="secondary" className="ml-auto" onClick={() => setSheetOpen(true)}>
                Open kit sheet
              </Button>
            </div>
          </div>
        </Card>
        <Card title="Gauge" icon={Activity}>
          <Gauge score={72} label="Ready" sub="Specimen score" size={190} />
        </Card>
        <Card title="Line chart">
          <LineChart
            label="Specimen line chart"
            data={KIT_LINE}
            lines={[
              { key: "a", label: "Series A", color: "var(--tm-chart-1)", fill: true },
              { key: "b", label: "Series B", color: "var(--tm-chart-2)", dashed: true },
            ]}
            band={{ from: 4, to: 8, label: "Band" }}
          />
        </Card>
        <Card title="Stacked bars and heatmap">
          <div className="flex flex-col gap-4">
            <StackedBars label="Specimen stacked bars" days={KIT_BARS} limit={9} limitLabel="Limit" height={120} />
            <Heatmap label="Specimen heatmap" rows={KIT_HEAT} days={KIT_DAYS} max={12} />
          </div>
        </Card>
      </div>
      <Sheet open={sheetOpen} onClose={() => setSheetOpen(false)} title="Kit sheet" description="A panel on desktop, a bottom sheet on phones.">
        <p className="text-[13px] text-dim">Sheets trap focus, close on Escape or the scrim, and hand focus back.</p>
      </Sheet>
    </div>
  );
}

export function DesignGallery() {
  const [tab, setTab] = useState("overview");
  const [range, setRange] = useState<(typeof RANGES)[number]["value"]>("30d");
  const [tableState, setTableState] = useState<"rows" | "loading" | "empty">("rows");
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <PageHeader
        breadcrumb={[{ label: "Workspace" }, { label: "Design system" }]}
        title="Design system"
        description="Tokens, type and components every TravelMind page is built from. Specimens only, never product data."
        actions={
          <>
            <Button variant="secondary">
              <Download size={15} aria-hidden="true" /> Export
            </Button>
            <Button>
              <Plus size={15} aria-hidden="true" /> Create enquiry
            </Button>
          </>
        }
        tabs={
          <Tabs
            label="Specimen sections"
            value={tab}
            onChange={setTab}
            tabs={[
              { id: "overview", label: "Overview" },
              { id: "quotes", label: "Quotes" },
              { id: "activity", label: "Activity" },
            ]}
          />
        }
      />

      <Section
        title="Themes"
        description="The UI kit's Aurora, Ocean, Ember and Forest (each with light and high-contrast looks), plus Clearsky and Contrast for accessibility. Each card is drawn in its own theme; choose one to apply it."
      >
        <ThemePreviews />
      </Section>

      <Section title="Colour tokens" description="Deep glass surfaces, one accent gradient, status hues always paired with a label.">
        <Swatches tokens={SURFACE_TOKENS} />
        <Swatches tokens={TEXT_TOKENS} />
        <Swatches tokens={STATUS_TOKENS} />
      </Section>

      <Section title="Chart palette" description="Categorical hues, assigned in this fixed order.">
        <Swatches tokens={CHART_TOKENS} />
      </Section>

      <Section
        title="Typography"
        description="Space Grotesk for titles and big numbers, Inter for the interface, JetBrains Mono for HUD labels, prices, codes and times. Sentence case."
      >
        <dl className="flex flex-col divide-y divide-line rounded-lg border border-line bg-surface">
          {TYPE_SCALE.map((row) => (
            <div key={row.name} className="grid items-baseline gap-1 px-4 py-3 sm:grid-cols-[9rem_7rem_minmax(0,1fr)] sm:gap-4">
              <dt className="text-[13px] text-ink">{row.name}</dt>
              <dd className="font-mono text-[11px] text-faint">{row.spec}</dd>
              <dd className={`min-w-0 truncate text-ink ${row.className}`}>{row.sample}</dd>
            </div>
          ))}
        </dl>
      </Section>

      <Section title="Charts" description="Key figures are compact glass Stat cards in one row; charts keep a table view for screen readers.">
        <KpiStrip label="Specimen key figures" columns={3}>
          <KpiTile label="Metric A" value="24" delta={{ pct: 12, direction: "up", good: true }} series={SPECIMEN_SPARK} hint="vs previous 30 days" />
          <KpiTile label="Metric B" value="—" delta={{ pct: null, direction: "flat", good: true }} hint="No comparison yet" />
          <KpiTile label="Metric C" value="" loading />
        </KpiStrip>
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title="Area trend" description="Two series, shared axis">
            <AreaTrend label="Specimen trend" valueFormat={String} series={SPECIMEN_TREND} />
          </Panel>
          <Panel title="Bar list" description="Ranked values">
            <BarList
              label="Specimen ranking"
              valueFormat={String}
              items={[
                { label: "Item one", value: 18, hint: "Hint text" },
                { label: "Item two", value: 11 },
                { label: "Item three", value: 6 },
                { label: "Item four", value: 2 },
              ]}
            />
          </Panel>
          <Panel title="Funnel" description="Stage-to-stage conversion">
            <Funnel
              label="Specimen funnel"
              valueFormat={String}
              stages={[
                { label: "Stage 1", count: 40 },
                { label: "Stage 2", count: 22 },
                { label: "Stage 3", count: 9 },
              ]}
            />
          </Panel>
          <Panel title="Donut and latency" description="Part to whole; response-time spread">
            <div className="flex flex-col gap-5">
              <Donut
                label="Specimen share"
                slices={[
                  { label: "Part one", value: 5 },
                  { label: "Part two", value: 3 },
                  { label: "Part three", value: 2 },
                ]}
              />
              <LatencyBand p50={120} p95={480} max={900} />
            </div>
          </Panel>
        </div>
      </Section>

      <Section title="Controls" description="Primary (the accent gradient) for the one main action; secondary for the rest; ghost in toolbars.">
        <div className="flex flex-wrap items-center gap-2">
          <Button>Send quote</Button>
          <Button variant="secondary">Save draft</Button>
          <Button variant="ghost">Cancel</Button>
          <Button variant="danger">Delete enquiry</Button>
          <Button loading>Searching suppliers…</Button>
          <Button disabled>Disabled</Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm">
            <Plus size={14} aria-hidden="true" /> Create enquiry
          </Button>
          <Button size="sm" variant="secondary">
            Invite teammate
          </Button>
          <Button size="sm" variant="ghost">
            View all
          </Button>
          <SegmentedControl label="Range" options={RANGES} value={range} onChange={setRange} />
        </div>
      </Section>

      <Section title="Fields" description="Label above, 40px control, helper or error text below.">
        <div className="grid max-w-2xl gap-4 sm:grid-cols-2">
          <TextField label="Email" placeholder="you@agency.com" />
          <TextField label="Password" type="password" hint="At least 10 characters" />
          <TextField label="Agency name" defaultValue="!" error="Agency name is too short." />
          <SelectField label="Cabin" defaultValue="economy" hint="Applies to every leg">
            <option value="economy">Economy</option>
            <option value="premium">Premium economy</option>
            <option value="business">Business</option>
          </SelectField>
        </div>
      </Section>

      <Section title="Signals" description="Status by colour, meaning by text. Violet is reserved for AI.">
        <div className="flex flex-wrap items-center gap-2">
          <Badge>Neutral</Badge>
          <Badge tone="primary">Active</Badge>
          <Badge tone="info">Info</Badge>
          <Badge tone="ok">Verified</Badge>
          <Badge tone="warn">Policy</Badge>
          <Badge tone="danger">Blocked</Badge>
          <Badge tone="ai">Copilot</Badge>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ProvenanceBadge provenance="LIVE" />
          <ProvenanceBadge provenance="CACHED" />
          <ProvenanceBadge provenance="SANDBOX" />
        </div>
        <div className="flex flex-wrap items-center gap-5 text-[13px] text-dim">
          <StatusDot status="ok" label="API online" />
          <StatusDot status="degraded" label="API degraded" />
          <StatusDot status="down" label="API offline" />
          <StatusDot status="unknown" label="Checking" />
        </div>
      </Section>

      <Section title="Status pills" description="Enquiry and quote lifecycle.">
        <div className="flex flex-wrap items-center gap-2">
          {(Object.keys(STATUS_PILL) as PillStatus[]).map((status) => (
            <StatusPill key={status} status={status} />
          ))}
        </div>
      </Section>

      <Section title="Avatars">
        <div className="flex flex-wrap items-center gap-4">
          <Avatar name="Asha Verma" size="sm" />
          <Avatar name="Rohan Iyer" />
          <Avatar name="Lena Park" size="lg" />
          <AvatarStack names={["Asha Verma", "Rohan Iyer", "Lena Park", "Omar Haddad", "Mei Chen"]} />
        </div>
      </Section>

      <Section title="Readouts" description="Labelled values in mono.">
        <dl className="grid max-w-xl grid-cols-2 gap-4">
          <Readout label="Great-circle distance" value="1,138" unit="km" hint="615 nmi" />
          <Readout label="Est. flight time" value="1h 58m" hint="Estimate" />
        </dl>
      </Section>

      <Section title="Panels" description="The kit's glass card: header row with an optional icon chip, body, optional footer. 18px padding, 22px radius.">
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel
            title="Open quotes"
            icon={Inbox}
            description="Sent in the last 30 days"
            actions={<Button size="sm" variant="ghost">Export</Button>}
            footer={
              <button type="button" className="rounded-[4px] font-medium text-primary hover:underline">
                View all quotes →
              </button>
            }
          >
            <p className="text-[13px] text-dim">Card body. Tables and lists use the `flush` option to run edge to edge.</p>
          </Panel>
          <Panel eyebrow="Copilot" title="AI panel" tone="ai">
            <p className="text-[13px] text-dim">AI content carries the violet hairline and label.</p>
          </Panel>
          <Panel title="Nested panel" variant="flat" dense>
            <p className="text-[13px] text-dim">Surface-2 panel for content inside a card or dialog.</p>
          </Panel>
        </div>
      </Section>

      <Section title="Navigation" description="Tabs sit under the page header; the selected tab is underlined in the accent.">
        <p className="text-[13px] text-dim">
          Selected tab: <span className="font-mono text-ink">{tab}</span> · range <span className="font-mono text-ink">{range}</span>
        </p>
      </Section>

      <Section title="Overlays" description="Dialogs and drawers are kit sheets (a bottom sheet on phones); menus and toasts share one elevation.">
        <OverlayDemo />
      </Section>

      <Section title="Data table" description="HUD headers, 44px rows on glass, right-aligned mono numbers, actions on hover or focus.">
        <Panel
          flush
          title="Enquiries"
          headerRight={
            <SegmentedControl
              label="Table state"
              value={tableState}
              onChange={setTableState}
              options={[
                { value: "rows", label: "Rows" },
                { value: "loading", label: "Loading" },
                { value: "empty", label: "Empty" },
              ]}
            />
          }
        >
          <DataTable
            caption="Specimen enquiries"
            columns={SPECIMEN_COLUMNS}
            rows={tableState === "rows" ? SPECIMEN_ROWS : []}
            loading={tableState === "loading"}
            getRowId={(r) => r.id}
            initialSort={{ key: "ref", direction: "desc" }}
            rowActions={(r) => (
              <Button size="sm" variant="ghost" iconOnly aria-label={`Edit ${r.ref}`}>
                <Pencil size={14} aria-hidden="true" />
              </Button>
            )}
            emptyState={<EmptyState icon={Inbox} title="No enquiries yet" description="Enquiries appear here as you create them." />}
          />
        </Panel>
      </Section>

      <Section title="Loading and empty" description="Skeletons are sized like the content; empty states offer the one action that fills them.">
        <div className="grid gap-4 lg:grid-cols-2">
          <PanelSkeleton title="Loading panel" />
          <Panel title="Empty panel">
            <EmptyState
              icon={Inbox}
              title="No quotes yet"
              description="Quotes you send to clients show up here."
              action={{ label: "Create enquiry", onClick: () => {} }}
            />
          </Panel>
          <Skeleton className="h-8 w-40" />
        </div>
      </Section>

      <Section title="UI kit" description="The kit's own components (src/kit), on the same tokens: cards, HUD labels, badges, segmented switches, toggles, avatars, stats, the sheet and its charts.">
        <KitShowcase />
      </Section>

      <Section title="Keyboard">
        <p className="flex flex-wrap items-center gap-1.5 text-[13px] text-dim">
          Search with <Kbd>Ctrl</Kbd>
          <Kbd>K</Kbd>, close overlays with <Kbd>Esc</Kbd>, move through tabs with <Kbd>←</Kbd>
          <Kbd>→</Kbd>
        </p>
      </Section>
    </div>
  );
}

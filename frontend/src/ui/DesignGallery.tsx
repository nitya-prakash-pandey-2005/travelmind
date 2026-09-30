import { Copy, Inbox, Pencil, Send, Trash2 } from "lucide-react";
import { useState } from "react";
import { Avatar, AvatarStack } from "./Avatar";
import { Badge } from "./Badge";
import { Button } from "./Button";
import { AreaTrend, BarList, Donut, Funnel, KpiTile, LatencyBand, type TrendSeries } from "./charts";
import { DataTable, type DataTableColumn } from "./DataTable";
import { Dialog } from "./Dialog";
import { Drawer } from "./Drawer";
import { EmptyState } from "./EmptyState";
import { Kbd } from "./Kbd";
import { Menu } from "./Menu";
import { Panel } from "./Panel";
import { Readout } from "./Readout";
import { SegmentedControl } from "./SegmentedControl";
import { PanelSkeleton, Skeleton } from "./Skeleton";
import { StatusDot } from "./StatusDot";
import { STATUS_PILL, StatusPill, type PillStatus } from "./StatusPill";
import { Tabs } from "./Tabs";
import { TextField } from "./TextField";
import { useToast } from "./toast/useToast";

const TOKENS = [
  "--tm-void",
  "--tm-deck",
  "--tm-raised",
  "--tm-line",
  "--tm-text",
  "--tm-text-dim",
  "--tm-primary",
  "--tm-ai",
  "--tm-warn",
  "--tm-ok",
  "--tm-danger",
];

const CHART_TOKENS = ["--tm-chart-1", "--tm-chart-2", "--tm-chart-3", "--tm-chart-4", "--tm-chart-5", "--tm-chart-6"];

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

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex min-w-0 flex-col gap-3">
      <h2 className="font-display text-sm uppercase tracking-[0.25em] text-primary">{title}</h2>
      {children}
    </section>
  );
}

function Swatches({ tokens }: { tokens: string[] }) {
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
      {tokens.map((token) => (
        <li key={token} className="flex flex-col gap-1">
          <span className="h-12 rounded-sm border border-line" style={{ background: `var(${token})` }} />
          <code className="font-mono text-xs text-dim">{token}</code>
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
    <div className="flex flex-wrap items-center gap-3">
      <Button variant="ghost" onClick={() => setDialogOpen(true)}>
        Open dialog
      </Button>
      <Button variant="ghost" onClick={() => setDrawerOpen(true)}>
        Open drawer
      </Button>
      <Menu
        trigger="Actions"
        items={[
          { label: "Edit", icon: Pencil, onSelect: () => toast({ tone: "info", title: "Edit selected" }) },
          { label: "Duplicate", icon: Copy, onSelect: () => toast({ tone: "info", title: "Duplicate selected" }) },
          { label: "Delete", icon: Trash2, danger: true, onSelect: () => toast({ tone: "danger", title: "Delete selected" }) },
        ]}
      />
      <Button variant="ghost" onClick={() => toast({ tone: "ok", title: "Saved", description: "Changes are stored." })}>
        Toast · ok
      </Button>
      <Button variant="ghost" onClick={() => toast({ tone: "warn", title: "Rate limited", description: "Try again shortly." })}>
        Toast · warn
      </Button>
      <Button variant="danger" onClick={() => toast({ tone: "danger", title: "Send failed" })}>
        Toast · danger
      </Button>
      <Dialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        title="Dialog title"
        description="Native modal dialog: focus stays inside, Escape closes."
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={() => setDialogOpen(false)}>
              <Send size={14} aria-hidden="true" /> Confirm
            </Button>
          </>
        }
      >
        <TextField label="Field" placeholder="Focus lands here" data-autofocus="" />
      </Dialog>
      <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)} title="Drawer title" description="Side panel for record details.">
        <dl className="grid grid-cols-2 gap-4">
          <Readout label="Label" value="Value" />
          <Readout label="Metric" value="42" unit="pts" />
        </dl>
      </Drawer>
    </div>
  );
}

/** Living style guide for the Mission Control design language. */
export function DesignGallery() {
  const [tab, setTab] = useState("overview");
  const [range, setRange] = useState<(typeof RANGES)[number]["value"]>("30d");
  const [tableState, setTableState] = useState<"rows" | "loading" | "empty">("rows");
  return (
    <div className="flex flex-col gap-8">
      <header>
        <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-dim">Design system</p>
        <h1 className="font-display text-2xl text-ink">Mission Control</h1>
      </header>

      <Section title="Colour tokens">
        <Swatches tokens={TOKENS} />
      </Section>

      <Section title="Chart palette">
        <Swatches tokens={CHART_TOKENS} />
      </Section>

      <Section title="Charts">
        <p className="text-sm text-dim">Component showcase with specimen shapes — not product data.</p>
        <div className="grid gap-4 sm:grid-cols-3">
          <KpiTile label="Metric A" value="24" delta={{ pct: 12, direction: "up", good: true }} series={SPECIMEN_SPARK} hint="vs previous period" />
          <KpiTile label="Metric B" value="—" delta={{ pct: null, direction: "flat", good: true }} />
          <KpiTile label="Metric C" value="" loading />
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel variant="glass" eyebrow="Specimen" title="Area trend">
            <AreaTrend label="Specimen trend" valueFormat={String} series={SPECIMEN_TREND} />
          </Panel>
          <Panel variant="glass" eyebrow="Specimen" title="Bar list">
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
          <Panel variant="glass" eyebrow="Specimen" title="Funnel">
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
          <Panel variant="glass" eyebrow="Specimen" title="Donut and latency">
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

      <Section title="Typography">
        <p className="font-display text-3xl tracking-[0.2em] text-ink">CHAKRA PETCH · DISPLAY</p>
        <p className="font-sans text-base text-ink">IBM Plex Sans carries body copy and long-form text.</p>
        <p className="font-mono text-base text-primary">JETBRAINS MONO · DEL → BOM · INR 4,500 · PNR X7Q2LM</p>
      </Section>

      <Section title="Controls">
        <div className="flex flex-wrap gap-3">
          <Button>Engage</Button>
          <Button variant="ghost">Standby</Button>
          <Button variant="danger">Abort</Button>
          <Button loading>Scanning</Button>
          <Button size="sm">Small</Button>
        </div>
      </Section>

      <Section title="Fields">
        <div className="grid max-w-xl gap-4 sm:grid-cols-2">
          <TextField label="Email" placeholder="you@agency.com" />
          <TextField label="Password" type="password" hint="At least 10 characters" />
          <TextField label="Agency name" defaultValue="!" error="Agency name is too short." />
        </div>
      </Section>

      <Section title="Signals">
        <div className="flex flex-wrap items-center gap-3">
          <Badge>neutral</Badge>
          <Badge tone="primary">live</Badge>
          <Badge tone="ok">verified</Badge>
          <Badge tone="warn">policy</Badge>
          <Badge tone="danger">blocked</Badge>
          <Badge tone="ai">ai</Badge>
          <StatusDot status="ok" label="API online" />
          <StatusDot status="degraded" label="API degraded" />
          <StatusDot status="down" label="API offline" />
        </div>
      </Section>

      <Section title="Status pills">
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

      <Section title="Readouts">
        <dl className="grid max-w-xl grid-cols-2 gap-4">
          <Readout label="Great-circle distance" value="1,138" unit="km" hint="615 nmi" />
          <Readout label="Est. flight time" value="1h 58m" hint="Estimate" />
        </dl>
      </Section>

      <Section title="Panels">
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel eyebrow="Instrument" title="Default panel">
            <p className="text-sm text-dim">Bracketed corners in the primary accent.</p>
          </Panel>
          <Panel eyebrow="Copilot" title="AI panel" tone="ai">
            <p className="text-sm text-dim">AI activity uses the magenta accent.</p>
          </Panel>
          <Panel
            eyebrow="Surface"
            title="Glass panel"
            variant="glass"
            headerRight={<SegmentedControl label="Range" options={RANGES} value={range} onChange={setRange} />}
          >
            <p className="text-sm text-dim">Layered glass, gradient hairline, inner glow while focused within.</p>
          </Panel>
          <Panel eyebrow="Surface" title="Flat panel · dense" variant="flat" dense>
            <p className="text-sm text-dim">Plain inset surface for nested content.</p>
          </Panel>
        </div>
      </Section>

      <Section title="Navigation">
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
        <p className="text-sm text-dim">
          Selected: <span className="font-mono text-ink">{tab}</span> · range{" "}
          <span className="font-mono text-ink">{range}</span>
        </p>
      </Section>

      <Section title="Overlays">
        <OverlayDemo />
      </Section>

      <Section title="Data table">
        <Panel
          variant="glass"
          title="Table specimen"
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
            emptyState={<EmptyState icon={Inbox} title="Nothing here yet" description="Rows appear as records are created." />}
          />
        </Panel>
      </Section>

      <Section title="Loading and empty">
        <div className="grid gap-4 lg:grid-cols-2">
          <PanelSkeleton title="Loading panel" eyebrow="Skeleton" />
          <Panel variant="glass" title="Empty panel" eyebrow="Empty state">
            <EmptyState
              icon={Inbox}
              title="No records yet"
              description="Explain what fills this space and offer the action that does."
              action={{ label: "Take action", onClick: () => {} }}
            />
          </Panel>
          <Skeleton className="h-8 w-40" />
        </div>
      </Section>

      <Section title="Keyboard">
        <p className="flex flex-wrap items-center gap-2 text-sm text-dim">
          Open the command palette with <Kbd>Ctrl</Kbd>
          <Kbd>K</Kbd> · close overlays with <Kbd>Esc</Kbd> · move through tabs with <Kbd>←</Kbd>
          <Kbd>→</Kbd>
        </p>
      </Section>
    </div>
  );
}

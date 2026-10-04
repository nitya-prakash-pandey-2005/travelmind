import { BedDouble, LayoutDashboard, Plane, PlugZap, Search, Users, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import type { Provenance } from "../../api/offers";
import { Badge } from "../../ui/Badge";
import { cn } from "../../ui/cn";
import { ProvenanceBadge } from "../../ui/ProvenanceBadge";
import { STATUS_PILL, type EnquiryStatus } from "../../ui/StatusPill";
import { BrandMark } from "./Wordmark";

/**
 * The illustration kit for the public pages: small, static copies of real product screens drawn with
 * the product's own primitives. Everything here is sample data. Every place it is drawn carries a
 * "Sample data" badge and a caption saying so; none of it is presented as a live figure.
 */

// ---- Sample data ---------------------------------------------------------------------------------

type SampleFare = {
  code: string;
  airline: string;
  depart: string;
  arrive: string;
  duration: string;
  co2: string;
  price: string;
  provenance: Provenance;
};

export const SAMPLE_FARES: SampleFare[] = [
  {
    code: "6E",
    airline: "IndiGo",
    depart: "06:10",
    arrive: "08:25",
    duration: "3h 45m",
    co2: "198 kg",
    price: "₹16,990",
    provenance: "LIVE",
  },
  {
    code: "EK",
    airline: "Emirates",
    depart: "09:55",
    arrive: "12:05",
    duration: "3h 40m",
    co2: "214 kg",
    price: "₹18,420",
    provenance: "LIVE",
  },
  {
    code: "AI",
    airline: "Air India",
    depart: "13:30",
    arrive: "15:50",
    duration: "3h 50m",
    co2: "205 kg",
    price: "≈ ₹17,850",
    provenance: "CACHED",
  },
  {
    code: "FZ",
    airline: "flydubai",
    depart: "20:15",
    arrive: "22:30",
    duration: "3h 45m",
    co2: "192 kg",
    price: "₹15,600",
    provenance: "SANDBOX",
  },
];

/** The full search's other results, merged in by departure time on the fare search screen. */
const MORE_FARES: SampleFare[] = [
  {
    code: "QP",
    airline: "Akasa Air",
    depart: "11:20",
    arrive: "13:35",
    duration: "3h 45m",
    co2: "189 kg",
    price: "₹16,450",
    provenance: "LIVE",
  },
  {
    code: "SG",
    airline: "SpiceJet",
    depart: "17:40",
    arrive: "19:55",
    duration: "3h 45m",
    co2: "201 kg",
    price: "₹15,980",
    provenance: "SANDBOX",
  },
];

export const ALL_SAMPLE_FARES = [...SAMPLE_FARES, ...MORE_FARES].sort((a, b) => a.depart.localeCompare(b.depart));

/** The real sidebar's destinations (see shell/Sidebar NAV_GROUPS), without the design system page. */
const NAV: { group: string; items: { label: string; icon: LucideIcon }[] }[] = [
  {
    group: "Operate",
    items: [{ label: "Command Center", icon: LayoutDashboard }],
  },
  {
    group: "Market",
    items: [
      { label: "Fare search", icon: Plane },
      { label: "Hotel search", icon: BedDouble },
    ],
  },
  {
    group: "Admin",
    items: [
      { label: "Team", icon: Users },
      { label: "Suppliers", icon: PlugZap },
    ],
  },
];

export type NavLabel = "Command Center" | "Fare search" | "Hotel search" | "Team" | "Suppliers";

// ---- Frame ---------------------------------------------------------------------------------------

export function SampleBadge() {
  return <Badge tone="warn">Sample data</Badge>;
}

/** A figure whose picture is hidden from assistive tech; the visible caption says what it shows. */
export function Illustration({ caption, children, className }: { caption: string; children: ReactNode; className?: string }) {
  return (
    <figure className={cn("min-w-0", className)}>
      <div aria-hidden="true" className="select-none">
        {children}
      </div>
      <figcaption className="mt-3 text-xs leading-5 text-faint">{caption}</figcaption>
    </figure>
  );
}

/** Width from which the window shows the sidebar (phones never get it). */
const SIDEBAR_FROM = { md: "md:flex", xl: "xl:flex" } as const;

/** The app window: top bar (agency, search, sample badge), the real sidebar, a status bar. */
export function PreviewWindow({
  active,
  children,
  sidebar = "md",
  className,
}: {
  active: NavLabel;
  children: ReactNode;
  sidebar?: keyof typeof SIDEBAR_FROM | false;
  className?: string;
}) {
  return (
    <div className={cn("overflow-hidden rounded-lg border border-line-strong bg-bg", className)}>
      <div className="flex h-10 items-center gap-3 border-b border-line bg-surface px-3">
        <span className="flex gap-1.5" aria-hidden="true">
          <span className="h-2.5 w-2.5 rounded-full bg-line-strong" />
          <span className="h-2.5 w-2.5 rounded-full bg-line-strong" />
          <span className="h-2.5 w-2.5 rounded-full bg-line-strong" />
        </span>
        <span className="ml-1 flex items-center gap-2">
          <BrandMark className="h-4 w-4" />
          <span className="text-[13px] font-medium text-ink">Example Travels</span>
        </span>
        <span className="ml-3 hidden h-7 min-w-0 flex-1 items-center gap-2 rounded-md border border-line bg-surface-2 px-2.5 text-xs text-faint md:flex md:max-w-72">
          <Search size={13} />
          <span className="truncate">Search clients, enquiries, quotes…</span>
          <span className="ml-auto shrink-0 whitespace-nowrap rounded-[4px] border border-line px-1 font-mono text-[10px]">Ctrl K</span>
        </span>
        <span className="ml-auto">
          <SampleBadge />
        </span>
      </div>
      <div className="flex">
        {sidebar && (
          <div className={cn("hidden w-44 shrink-0 flex-col gap-3 border-r border-line bg-surface px-2 py-3", SIDEBAR_FROM[sidebar])}>
            {NAV.map(({ group, items }) => (
              <div key={group} className="flex flex-col gap-0.5">
                <span className="tm-micro px-2 pb-1">{group}</span>
                {items.map(({ label, icon: Icon }) => (
                  <span
                    key={label}
                    className={cn(
                      "relative flex h-7 items-center gap-2 whitespace-nowrap rounded-md px-2 text-xs",
                      label === active ? "bg-surface-2 text-ink" : "text-dim",
                    )}
                  >
                    {label === active && <span className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-primary" />}
                    <Icon size={13} strokeWidth={1.75} className={cn("shrink-0", label === active ? "text-primary" : "text-faint")} />
                    <span className="min-w-0 truncate">{label}</span>
                  </span>
                ))}
              </div>
            ))}
          </div>
        )}
        <div className="min-w-0 flex-1 p-3 sm:p-4">{children}</div>
      </div>
      <div className="flex h-7 items-center gap-4 border-t border-line bg-surface px-3 font-mono text-[10px] text-faint">
        <span className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-ok" />
          API 38 ms
        </span>
        <span className="hidden sm:inline">2 suppliers online</span>
        <span className="ml-auto">09:42 UTC</span>
      </div>
    </div>
  );
}

/** Breadcrumb, page title and an optional primary action, as on every product page. */
export function ScreenHeader({ crumb, title, meta, action }: { crumb: string; title: string; meta?: string; action?: string }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-2">
      <div className="min-w-0">
        <p className="text-[11px] text-faint">{crumb}</p>
        <p className="mt-0.5 text-base font-semibold tracking-[-0.01em] text-ink">{title}</p>
        {meta && <p className="text-[11px] text-dim">{meta}</p>}
      </div>
      {action && (
        <span className="inline-flex h-7 items-center rounded-md bg-primary px-2.5 text-xs font-medium text-primary-ink">{action}</span>
      )}
    </div>
  );
}

/** A panel inside a preview screen: title row, then content. */
export function MiniPanel({
  title,
  aside,
  children,
  className,
}: {
  title: string;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0 rounded-md border border-line bg-surface p-3", className)}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="truncate text-xs font-semibold text-ink">{title}</p>
        {aside}
      </div>
      {children}
    </div>
  );
}

// ---- Charts --------------------------------------------------------------------------------------

/** A 64×20 sparkline in one hue. */
export function Spark({ points, className }: { points: number[]; className?: string }) {
  const max = Math.max(...points);
  const min = Math.min(...points);
  const span = max - min || 1;
  const path = points
    .map((value, index) => `${((index / (points.length - 1)) * 64).toFixed(1)},${(18 - ((value - min) / span) * 16).toFixed(1)}`)
    .join(" ");
  return (
    <svg viewBox="0 0 64 20" className={cn("h-5 w-16", className)}>
      <polyline points={path} fill="none" stroke="var(--tm-chart-1)" strokeWidth="1.25" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

type Kpi = { label: string; value: string; delta: string; points: number[] };

export const SAMPLE_KPIS: Kpi[] = [
  {
    label: "Open enquiries",
    value: "24",
    delta: "+3",
    points: [12, 14, 13, 16, 18, 17, 21, 24],
  },
  {
    label: "Pipeline value",
    value: "₹6.2L",
    delta: "+11%",
    points: [3.1, 3.4, 3.9, 3.8, 4.6, 5.1, 5.6, 6.2],
  },
  {
    label: "Win rate",
    value: "38%",
    delta: "+4 pts",
    points: [30, 31, 29, 33, 34, 36, 35, 38],
  },
  {
    label: "Response time",
    value: "18 min",
    delta: "−6 min",
    points: [31, 28, 27, 25, 24, 22, 20, 18],
  },
  {
    label: "Searches",
    value: "412",
    delta: "+58",
    points: [210, 240, 260, 250, 300, 340, 380, 412],
  },
];

const KPI_COLUMNS = {
  4: "grid-cols-2 sm:grid-cols-4",
  5: "grid-cols-2 sm:grid-cols-5",
} as const;

/** KPI tiles in one bordered strip with hairline dividers, like the Command Center's key figures. */
export function KpiStrip({ count = 4, className }: { count?: keyof typeof KPI_COLUMNS; className?: string }) {
  return (
    <div className={cn("grid gap-px overflow-hidden rounded-md border border-line bg-line", KPI_COLUMNS[count], className)}>
      {SAMPLE_KPIS.slice(0, count).map((kpi, index) => (
        <div key={kpi.label} className={cn("min-w-0 bg-surface px-3 py-2.5", count === 5 && index === 4 && "max-sm:hidden")}>
          <p className="truncate text-[10px] font-medium uppercase tracking-[0.06em] text-faint">{kpi.label}</p>
          <p className="mt-1 font-mono text-lg font-medium leading-6 tabular-nums text-ink">{kpi.value}</p>
          <div className="mt-1 flex items-center justify-between gap-2">
            <span className="whitespace-nowrap font-mono text-[10px] text-ok">{kpi.delta}</span>
            <Spark points={kpi.points} className="h-4 w-12 shrink-0 max-sm:hidden" />
          </div>
        </div>
      ))}
    </div>
  );
}

const STAGES: { status: EnquiryStatus; count: number; value: string }[] = [
  { status: "new", count: 9, value: "₹2.1L" },
  { status: "quoting", count: 7, value: "₹1.8L" },
  { status: "quoted", count: 5, value: "₹1.6L" },
  { status: "won", count: 3, value: "₹0.7L" },
];

/** Enquiries by stage with a bar per stage (the Command Center's pipeline panel). */
export function PipelineStages() {
  return (
    <ol className="flex flex-col gap-2">
      {STAGES.map((stage) => (
        <li key={stage.status} className="grid grid-cols-[4.25rem_minmax(0,1fr)_1.5rem_2.75rem] items-center gap-2 text-[11px]">
          <span className="text-ink">{STATUS_PILL[stage.status].label}</span>
          <span className="relative h-1.5 overflow-hidden rounded-[2px] bg-chart-grid">
            <span className="absolute inset-y-0 left-0 rounded-r-[2px] bg-chart-1" style={{ width: `${(stage.count / 9) * 100}%` }} />
          </span>
          <span className="text-right font-mono tabular-nums text-ink">{stage.count}</span>
          <span className="text-right font-mono tabular-nums text-dim">{stage.value}</span>
        </li>
      ))}
    </ol>
  );
}

/** Enquiries per day over 30 days, as a quiet area chart. */
export function TrendChart({ className }: { className?: string }) {
  const values = [4, 6, 5, 7, 6, 9, 8, 7, 10, 9, 11, 8, 12, 11, 10, 13, 12, 14, 11, 15, 13, 16, 14, 17, 15, 18, 16, 19, 18, 21];
  const x = (index: number) => (index / (values.length - 1)) * 300;
  const y = (value: number) => 92 - (value / 24) * 84;
  const line = values.map((value, index) => `${x(index).toFixed(1)},${y(value).toFixed(1)}`).join(" L ");
  return (
    <svg viewBox="0 0 300 96" preserveAspectRatio="none" className={cn("h-24 w-full", className)}>
      {[24, 48, 72].map((gridY) => (
        <line
          key={gridY}
          x1="0"
          x2="300"
          y1={gridY}
          y2={gridY}
          stroke="var(--tm-chart-grid)"
          strokeWidth="1"
          vectorEffect="non-scaling-stroke"
        />
      ))}
      <path d={`M ${line} L 300,96 L 0,96 Z`} fill="var(--tm-chart-1)" fillOpacity="0.12" />
      <path d={`M ${line}`} fill="none" stroke="var(--tm-chart-1)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

// ---- Fare search ---------------------------------------------------------------------------------

type FareTableVariant = "full" | "medium" | "compact";

const FARE_COLUMNS: Record<FareTableVariant, string> = {
  full: "grid-cols-[minmax(0,1fr)_auto_auto] sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_auto_auto_auto]",
  medium: "grid-cols-[minmax(0,1fr)_auto_auto] sm:grid-cols-[minmax(0,1fr)_auto_auto_auto]",
  compact: "grid-cols-[minmax(0,1fr)_auto_auto]",
};

/** The results table, with the product's provenance pills. */
export function FareTable({
  variant = "full",
  fares = SAMPLE_FARES,
  rows = fares.length,
  highlight = 0,
}: {
  variant?: FareTableVariant;
  fares?: SampleFare[];
  rows?: number;
  highlight?: number;
}) {
  const full = variant === "full";
  const co2 = variant !== "compact";
  return (
    <div className="overflow-hidden rounded-md border border-line bg-surface">
      <div className={cn("grid items-center gap-3 border-b border-line px-3 py-2 tm-micro", FARE_COLUMNS[variant])}>
        <span>Airline</span>
        {full && <span className="hidden sm:block">Depart – arrive</span>}
        {co2 && <span className="hidden text-right sm:block">CO₂ / pax</span>}
        <span className="text-right">Fare</span>
        <span>Source</span>
      </div>
      <ul>
        {fares.slice(0, rows).map((fare, index) => (
          <li
            key={fare.code}
            className={cn(
              "grid h-10 items-center gap-3 border-b border-line px-3 text-[13px] last:border-b-0",
              FARE_COLUMNS[variant],
              index === highlight && "bg-surface-2",
            )}
          >
            <span className="flex min-w-0 items-center gap-2">
              <span className="inline-flex h-5 w-7 shrink-0 items-center justify-center rounded-[4px] border border-line-strong font-mono text-[10px] text-dim">
                {fare.code}
              </span>
              <span className="truncate text-ink">{fare.airline}</span>
            </span>
            {full && (
              <span className="hidden min-w-0 truncate font-mono text-xs text-dim sm:block">
                {fare.depart} – {fare.arrive} <span className="text-faint">· {fare.duration}</span>
              </span>
            )}
            {co2 && <span className="hidden text-right font-mono text-xs text-dim sm:block">{fare.co2}</span>}
            <span className="text-right font-mono text-[13px] tabular-nums text-ink">{fare.price}</span>
            <ProvenanceBadge provenance={fare.provenance} className="justify-self-start" />
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Where the sample fare sits on the route's low–typical–high band. */
export function FareInsightCard({ className }: { className?: string }) {
  return (
    <div className={cn("rounded-md border border-line bg-surface p-3", className)}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[13px] font-semibold text-ink">Fare insight</p>
        <Badge tone="ok">Good</Badge>
      </div>
      <p className="mt-1 text-xs leading-4 text-dim">₹16,990 per traveller sits below the typical range for DEL → DXB in November.</p>
      <div className="relative mt-4 h-1.5 rounded-full bg-surface-2">
        <div className="absolute inset-y-0 left-[30%] right-[30%] rounded-full bg-line-strong" />
        <div className="absolute -top-1 left-[22%] h-3.5 w-0.5 rounded-full bg-ok" />
      </div>
      <div className="mt-2 flex justify-between font-mono text-[10px] text-faint">
        <span>₹14.2k</span>
        <span>Typical</span>
        <span>₹24.8k</span>
      </div>
    </div>
  );
}

const SUPPLIERS = [
  { name: "Duffel", kind: "Flights", latency: "412 ms", results: "3 fares" },
  { name: "LiteAPI", kind: "Hotels", latency: "655 ms", results: "38 hotels" },
  { name: "Fare cache", kind: "History", latency: "12 ms", results: "1 fare" },
];

export function SupplierStatusCard({ className }: { className?: string }) {
  return (
    <div className={cn("rounded-md border border-line bg-surface p-3", className)}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[13px] font-semibold text-ink">Supplier status</p>
        <span className="font-mono text-[10px] text-faint">last search</span>
      </div>
      <ul className="mt-2 flex flex-col gap-2">
        {SUPPLIERS.map((supplier) => (
          <li key={supplier.name} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 text-xs">
            <span className="flex min-w-0 items-center gap-2 text-ink">
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-ok" />
              <span className="truncate">{supplier.name}</span>
              <span className="truncate text-faint">{supplier.kind}</span>
            </span>
            <span className="font-mono text-dim">{supplier.latency}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** One source per chip, as in the fare search results header. */
export function SourceChips() {
  return (
    <ul className="flex flex-wrap gap-1.5">
      {SUPPLIERS.filter((s) => s.kind !== "Hotels").map((supplier) => (
        <li
          key={supplier.name}
          className="inline-flex h-6 items-center gap-1.5 rounded-full border border-line bg-surface px-2 text-[11px] text-dim"
        >
          <span className="h-1.5 w-1.5 rounded-full bg-ok" />
          <span className="text-ink">{supplier.name}</span>
          <span className="font-mono">{supplier.results}</span>
          <span className="font-mono text-faint">{supplier.latency}</span>
        </li>
      ))}
      <li className="inline-flex h-6 items-center gap-1.5 rounded-full border border-line bg-surface px-2 text-[11px] text-dim">
        <span className="h-1.5 w-1.5 rounded-full bg-warn" />
        <span className="text-ink">Sandbox</span>
        <span className="font-mono">2 fares</span>
      </li>
    </ul>
  );
}

/** The plotted route between two airports: a dashed great-circle style arc with a travelling dash. */
export function RouteArc({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 240 56" className={cn("h-14 w-full", className)}>
      {[14, 28, 42].map((gridY) => (
        <line key={gridY} x1="0" x2="240" y1={gridY} y2={gridY} stroke="var(--tm-chart-grid)" strokeDasharray="2 6" />
      ))}
      <path d="M 12 46 Q 120 -6 228 46" fill="none" stroke="var(--tm-line-strong)" strokeWidth="1.25" />
      <path d="M 12 46 Q 120 -6 228 46" fill="none" stroke="var(--tm-primary)" strokeWidth="1.75" strokeLinecap="round" className="tm-arc-flow" />
      {[12, 228].map((cx) => (
        <g key={cx}>
          <circle cx={cx} cy="46" r="7" fill="var(--tm-primary)" opacity="0.15" />
          <circle cx={cx} cy="46" r="3" fill="var(--tm-bg)" stroke="var(--tm-primary)" strokeWidth="1.5" />
        </g>
      ))}
    </svg>
  );
}

/**
 * The fare search console in one frame: route header with its arc, the result rows, and fare
 * insight beside supplier status. Nothing overlaps, so every row stays readable at any width.
 */
export function FareConsole({ rows = 3, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn("overflow-hidden rounded-lg border border-line-strong bg-bg", className)}>
      <div className="flex h-9 items-center gap-3 border-b border-line bg-surface px-3">
        <span className="tm-micro">Fare search</span>
        <span className="flex items-center gap-1.5 font-mono text-[10px] text-ok">
          <span className="tm-live relative h-1.5 w-1.5 rounded-full bg-ok" />3 sources
        </span>
        <span className="ml-auto">
          <SampleBadge />
        </span>
      </div>
      <div className="grid gap-3 p-3">
        <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3">
          <div>
            <p className="font-mono text-xl font-medium leading-6 text-ink">DEL</p>
            <p className="text-[10px] text-faint">New Delhi</p>
          </div>
          <div className="min-w-0 text-center">
            <RouteArc />
            <p className="-mt-1 font-mono text-[10px] text-faint">2,192 km · 3h 40m nonstop</p>
          </div>
          <div className="text-right">
            <p className="font-mono text-xl font-medium leading-6 text-ink">DXB</p>
            <p className="text-[10px] text-faint">Dubai</p>
          </div>
        </div>
        <p className="-mt-1 text-[11px] text-dim">Fri 14 Nov · 1 adult · Economy · 4 results, cheapest first</p>
        <FareTable variant="compact" rows={rows} />
        <div className="grid gap-3 sm:grid-cols-2">
          <FareInsightCard className="bg-surface" />
          <SupplierStatusCard />
        </div>
      </div>
      <div className="flex h-7 items-center gap-4 border-t border-line bg-surface px-3 font-mono text-[10px] text-faint">
        <span className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-ok" />
          Search 1.2 s
        </span>
        <span className="hidden sm:inline">Prices include taxes</span>
        <span className="ml-auto">09:42 UTC</span>
      </div>
    </div>
  );
}

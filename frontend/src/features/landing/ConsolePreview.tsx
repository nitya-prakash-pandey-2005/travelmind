import { Search } from "lucide-react";
import type { Provenance } from "../../api/offers";
import { Badge } from "../../ui/Badge";
import { cn } from "../../ui/cn";
import { ProvenanceBadge } from "../../ui/ProvenanceBadge";
import { BrandMark } from "./Wordmark";

/**
 * Everything in this file is sample data for an illustration of the product. Every place it is drawn
 * says so on screen ("Sample data") and in its caption; none of it is presented as a live figure.
 */
type SampleFare = {
  code: string;
  airline: string;
  depart: string;
  arrive: string;
  duration: string;
  stops: string;
  co2: string;
  price: string;
  provenance: Provenance;
};

const SAMPLE_FARES: SampleFare[] = [
  { code: "6E", airline: "IndiGo", depart: "06:10", arrive: "08:25", duration: "3h 45m", stops: "Direct", co2: "198 kg", price: "₹16,990", provenance: "LIVE" },
  { code: "EK", airline: "Emirates", depart: "09:55", arrive: "12:05", duration: "3h 40m", stops: "Direct", co2: "214 kg", price: "₹18,420", provenance: "LIVE" },
  { code: "AI", airline: "Air India", depart: "13:30", arrive: "15:50", duration: "3h 50m", stops: "Direct", co2: "205 kg", price: "≈ ₹17,850", provenance: "CACHED" },
  { code: "FZ", airline: "flydubai", depart: "20:15", arrive: "22:30", duration: "3h 45m", stops: "Direct", co2: "192 kg", price: "₹15,600", provenance: "SANDBOX" },
];

const NAV = ["Command Center", "Pipeline", "Quotes", "Clients", "Fare search", "Hotel search", "Suppliers", "Team"];
const ACTIVE_NAV = "Fare search";

const SUPPLIERS = [
  { name: "Duffel", kind: "Flights", latency: "412 ms" },
  { name: "LiteAPI", kind: "Hotels", latency: "655 ms" },
];

function SampleBadge() {
  return <Badge tone="warn">Sample data</Badge>;
}

/** The results table, shared by the landing preview and the sign-in panel. */
function FareTable({ compact = false }: { compact?: boolean }) {
  return (
    <div className="overflow-hidden rounded-md border border-line bg-surface">
      <div
        className={cn(
          "grid items-center gap-3 border-b border-line bg-surface px-3 py-2 tm-micro",
          compact ? "grid-cols-[minmax(0,1fr)_auto_auto]" : "grid-cols-[minmax(0,1fr)_auto_auto] sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_auto_auto_auto]",
        )}
      >
        <span>Airline</span>
        {!compact && <span className="hidden sm:block">Depart – arrive</span>}
        {!compact && <span className="hidden text-right sm:block">CO₂ / pax</span>}
        <span className="text-right">Fare</span>
        <span>Source</span>
      </div>
      <ul>
        {SAMPLE_FARES.map((fare, index) => (
          <li
            key={fare.code}
            className={cn(
              "grid h-10 items-center gap-3 border-b border-line px-3 text-[13px] last:border-b-0",
              compact ? "grid-cols-[minmax(0,1fr)_auto_auto]" : "grid-cols-[minmax(0,1fr)_auto_auto] sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_auto_auto_auto]",
              index === 1 && "bg-surface-2",
            )}
          >
            <span className="flex min-w-0 items-center gap-2">
              <span className="inline-flex h-5 w-7 shrink-0 items-center justify-center rounded-[4px] border border-line-strong font-mono text-[10px] text-dim">
                {fare.code}
              </span>
              <span className="truncate text-ink">{fare.airline}</span>
            </span>
            {!compact && (
              <span className="hidden min-w-0 truncate font-mono text-xs text-dim sm:block">
                {fare.depart} – {fare.arrive} <span className="text-faint">· {fare.duration}</span>
              </span>
            )}
            {!compact && <span className="hidden text-right font-mono text-xs text-dim sm:block">{fare.co2}</span>}
            <span className="text-right font-mono text-[13px] tabular-nums text-ink">{fare.price}</span>
            <ProvenanceBadge provenance={fare.provenance} className="justify-self-start" />
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Where the sample's typical fare sits on the route's low–typical–high band. */
function FareInsight() {
  return (
    <div className="rounded-md border border-line bg-surface p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[13px] font-semibold text-ink">Fare insight</p>
        <Badge tone="ok">Good</Badge>
      </div>
      <p className="mt-1 text-xs leading-4 text-dim">₹16,990 sits below the typical range for this route in November.</p>
      <div className="relative mt-4 h-1.5 rounded-full bg-surface-2">
        <div className="absolute inset-y-0 left-[30%] right-[30%] rounded-full bg-line-strong" />
        <div className="absolute -top-1 left-[22%] h-3.5 w-0.5 rounded-full bg-ok" />
      </div>
      <div className="mt-2 flex justify-between font-mono text-[10px] text-faint">
        <span>Low</span>
        <span>Typical</span>
        <span>High</span>
      </div>
    </div>
  );
}

function SupplierStatus() {
  return (
    <div className="rounded-md border border-line bg-surface p-3">
      <p className="text-[13px] font-semibold text-ink">Supplier status</p>
      <ul className="mt-2 flex flex-col gap-2">
        {SUPPLIERS.map((supplier) => (
          <li key={supplier.name} className="flex items-center justify-between gap-2 text-xs">
            <span className="flex items-center gap-2 text-ink">
              <span className="h-1.5 w-1.5 rounded-full bg-ok" />
              {supplier.name}
              <span className="text-faint">{supplier.kind}</span>
            </span>
            <span className="font-mono text-dim">{supplier.latency}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * A static, clearly labelled illustration of the fare search screen, drawn with the product's own
 * components. Hidden from assistive tech; the caption says what it shows.
 */
export function ConsolePreview({ caption }: { caption: string }) {
  return (
    <figure className="min-w-0">
      <div aria-hidden="true" className="overflow-hidden rounded-lg border border-line-strong bg-bg select-none">
        {/* Top bar */}
        <div className="flex h-10 items-center gap-3 border-b border-line bg-surface px-3">
          <BrandMark className="h-4 w-4" />
          <span className="text-[13px] font-medium text-ink">Example Travels</span>
          <span className="ml-3 hidden h-7 min-w-0 flex-1 items-center gap-2 rounded-md border border-line bg-surface-2 px-2.5 text-xs text-faint md:flex md:max-w-80">
            <Search size={13} />
            Search clients, enquiries, quotes…
          </span>
          <span className="ml-auto">
            <SampleBadge />
          </span>
        </div>
        <div className="flex">
          {/* Sidebar */}
          <div className="hidden w-44 shrink-0 flex-col gap-0.5 border-r border-line bg-surface p-2 md:flex">
            <span className="tm-micro px-2 pb-1 pt-1">Workspace</span>
            {NAV.map((item) => (
              <span
                key={item}
                className={cn(
                  "relative flex h-7 items-center rounded-md px-2 text-xs",
                  item === ACTIVE_NAV ? "bg-surface-2 text-ink" : "text-dim",
                )}
              >
                {item === ACTIVE_NAV && <span className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-primary" />}
                {item}
              </span>
            ))}
          </div>
          {/* Main */}
          <div className="min-w-0 flex-1 p-3 sm:p-4">
            <p className="text-[11px] text-faint">Workspace / Fare search</p>
            <div className="mt-1 flex flex-wrap items-end justify-between gap-2">
              <div className="min-w-0">
                <p className="font-mono text-base font-medium text-ink sm:text-lg">DEL → DXB</p>
                <p className="text-xs text-dim">Fri 14 Nov · 1 adult · Economy · 4 results from 3 sources</p>
              </div>
              <span className="hidden h-8 items-center rounded-md bg-primary px-3 text-[13px] font-medium text-primary-ink sm:inline-flex">
                Scan fares
              </span>
            </div>
            <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_15rem]">
              <FareTable />
              <div className="hidden flex-col gap-3 lg:flex">
                <FareInsight />
                <SupplierStatus />
              </div>
            </div>
          </div>
        </div>
        {/* Status bar */}
        <div className="flex h-7 items-center gap-4 border-t border-line bg-surface px-3 font-mono text-[10px] text-faint">
          <span className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-ok" />
            API 38 ms
          </span>
          <span className="hidden sm:inline">2 suppliers online</span>
          <span className="ml-auto">09:42 UTC</span>
        </div>
      </div>
      <figcaption className="mt-3 text-xs text-faint">{caption}</figcaption>
    </figure>
  );
}

/** Compact results card for the sign-in panel: the same sample rows, same labelling. */
export function FareRowsPreview({ caption }: { caption: string }) {
  return (
    <figure className="min-w-0">
      <div aria-hidden="true" className="rounded-lg border border-line-strong bg-bg p-3 select-none">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="font-mono text-sm font-medium text-ink">DEL → DXB</p>
            <p className="text-[11px] text-dim">Fri 14 Nov · 1 adult · Economy</p>
          </div>
          <SampleBadge />
        </div>
        <FareTable compact />
      </div>
      <figcaption className="mt-2 text-xs text-faint">{caption}</figcaption>
    </figure>
  );
}

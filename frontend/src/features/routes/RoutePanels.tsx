import { Link } from "@tanstack/react-router";
import { CalendarClock, ChartLine, History, Plane } from "lucide-react";
import { useState } from "react";
import type { Cabin } from "../../api/offers";
import type { CarrierFares, RouteIntel } from "../../api/routeIntel";
import { formatDate, formatDayMonth, formatRelativeTime } from "../../lib/format";
import { Badge } from "../../ui/Badge";
import { buttonClasses } from "../../ui/Button";
import { BarList, KpiStrip, KpiTile, type KpiDelta } from "../../ui/charts";
import { AreaTrend } from "../../ui/charts/AreaTrend";
import { DataTable, type DataTableColumn } from "../../ui/DataTable";
import { Panel } from "../../ui/Panel";
import { cn } from "../../ui/cn";
import {
  agencyStamp,
  bucketLabel,
  bucketRange,
  calendarDays,
  changePct,
  cheapestBucket,
  latestDay,
  money,
  plural,
  previousDay,
  routeName,
  totalSamples,
  WINDOW_DAYS,
} from "./routeFacts";

/** Where the figures come from. Sandbox fares are test inventory and say so. */
export function FamilyBadge({ family }: { family: RouteIntel["family"] }) {
  if (family === "market") return <Badge tone="ok">Market data</Badge>;
  if (family === "sandbox") return <Badge tone="warn">Sandbox data — for demonstration</Badge>;
  return null;
}

/** Fare search with this route filled in. */
export function ScanFaresLink({
  intel,
  cabin,
  variant = "primary",
}: {
  intel: { origin: string; destination: string };
  cabin: Cabin;
  variant?: "primary" | "secondary";
}) {
  return (
    <Link
      to="/app/fares"
      search={{ origin: intel.origin, destination: intel.destination, cabin }}
      className={buttonClasses({ variant, size: "sm" })}
    >
      <Plane size={14} aria-hidden="true" />
      Scan fares
    </Link>
  );
}

function medianDelta(intel: RouteIntel): KpiDelta | undefined {
  const last = latestDay(intel);
  const before = previousDay(intel);
  if (!last || !before) return undefined;
  const pct = changePct(last.median_minor, before.median_minor);
  if (pct === null) return undefined;
  const direction = Math.abs(pct) < 0.5 ? "flat" : pct > 0 ? "up" : "down";
  // Cheaper fares are the good news.
  return { pct, direction, good: pct <= 0 };
}

/**
 * The kit's KPI row (`g4 keep-2`): four columns on desktops, two on tablets and phones, at the kit gap. Five figures
 * fill it with spans: the median (with its trend) takes two cells, and on desktops the booking window and freshness
 * share the second row.
 */
export const FIGURES_GRID = "mb-4 [&>div]:grid-cols-2 [&>div]:gap-4 max-sm:[&>div]:gap-3 min-[1181px]:[&>div]:grid-cols-4";

// The strip widens a lone last tile on phones; here the fifth tile already has a partner (the median spans two).
const FIGURE_SPANS = ["col-span-2", "", "", "min-[1181px]:col-span-2", "max-sm:col-span-1! min-[1181px]:col-span-2"];

/** Grid cell for the figure at `index`. */
export function figureCell(index: number): string {
  return cn("grid min-w-0", FIGURE_SPANS[index]);
}

/** Median now, the typical range, sample count, the cheapest booking window and freshness. */
export function RouteFigures({ intel, timeZone, now }: { intel: RouteIntel; timeZone: string; now: Date }) {
  const last = latestDay(intel);
  const before = previousDay(intel);
  const best = cheapestBucket(intel);
  const days = intel.daily.length;
  return (
    <KpiStrip label="Route figures" columns={4} className={FIGURES_GRID}>
      <div className={figureCell(0)}>
      <KpiTile
        label="Median now"
        value={last ? money(last.median_minor, intel.currency) : "—"}
        delta={medianDelta(intel)}
        hint={last ? `${formatDayMonth(last.date)} · ${before ? `vs ${formatDayMonth(before.date)}` : plural(last.samples, "fare")}` : "No fares yet"}
        series={days > 1 ? intel.daily.map((day) => day.median_minor) : undefined}
        trendLabel={days > 1 ? "Daily median on days with fares" : undefined}
      />
      </div>
      <div className={figureCell(1)}>
      <KpiTile
        label="Typical range"
        value={last ? money(last.p25_minor, intel.currency) : "—"}
        unit={last ? `to ${money(last.p75_minor, intel.currency)}` : undefined}
        hint={last ? `Middle half of ${plural(last.samples, "fare")} on ${formatDayMonth(last.date)}` : "No fares yet"}
      />
      </div>
      <div className={figureCell(2)}>
      <KpiTile
        label="Fares seen"
        value={totalSamples(intel).toLocaleString("en-US")}
        hint={`${plural(days, "day")} with fares · last ${WINDOW_DAYS} days`}
      />
      </div>
      <div className={figureCell(3)}>
      <KpiTile
        label="Best time to book"
        value={best ? bucketRange(best.bucket) : "—"}
        unit={best ? "days out" : undefined}
        hint={best ? `Median ${money(best.median_minor, intel.currency)} · ${plural(best.samples, "fare")}` : "Not enough fares yet"}
      />
      </div>
      <div className={figureCell(4)}>
      <KpiTile
        label="Last updated"
        value={intel.updated_at ? formatRelativeTime(intel.updated_at, now) : "—"}
        hint={intel.updated_at ? `${agencyStamp(intel.updated_at, timeZone)} · to the hour` : "No fares yet"}
      />
      </div>
    </KpiStrip>
  );
}

/** The daily median as a line over the shaded 25th–75th percentile band. */
export function TrendPanel({ intel, className }: { intel: RouteIntel; className?: string }) {
  const format = (value: number) => money(value, intel.currency);
  const days = calendarDays(intel.daily);
  return (
    <Panel
      title="Daily median fare"
      icon={ChartLine}
      className={className}
      description={`Per traveller, one way, in ${intel.currency} · shaded band is the middle half of each day's fares (25th–75th percentile)`}
    >
      <AreaTrend
        label="Daily median fare"
        height={240}
        valueFormat={format}
        series={[
          {
            key: "median",
            label: "Median",
            color: 1,
            area: false,
            breakAtGaps: true,
            points: days.map((day) => ({ date: day.date, value: day.median })),
          },
        ]}
        band={{
          label: "Middle half",
          color: 1,
          points: days.map((day) => ({ date: day.date, low: day.low, high: day.high })),
        }}
      />
    </Panel>
  );
}

/** Median fare by how far ahead of departure it was seen. */
export function DaysOutPanel({ intel, className }: { intel: RouteIntel; className?: string }) {
  const best = cheapestBucket(intel);
  return (
    <Panel title="By days before departure" icon={CalendarClock} description="Median fare by how far ahead the fare was seen" className={className}>
      {/* Relative and clipped: the chart's screen-reader table is wider than a phone column. */}
      <div className="relative overflow-hidden">
      <BarList
        label="Median fare by days before departure"
        valueFormat={(value) => money(value, intel.currency)}
        items={intel.by_days_out.map((bucket) => ({
          label: bucketLabel(bucket.bucket),
          value: bucket.median_minor,
          hint: `${plural(bucket.samples, "fare")}${bucket.bucket === best?.bucket ? " · lowest" : ""}`,
        }))}
      />
      </div>
    </Panel>
  );
}

/** The busiest carriers on the route, with their share of fares and their median. */
export function CarriersPanel({ intel, className }: { intel: RouteIntel; className?: string }) {
  const counted = intel.carriers.reduce((sum, carrier) => sum + carrier.samples, 0);
  const cheapest = intel.carriers.reduce<CarrierFares | undefined>(
    (best, carrier) => (best === undefined || carrier.median_minor < best.median_minor ? carrier : best),
    undefined,
  );
  const share = (carrier: CarrierFares) => (counted > 0 ? Math.round((carrier.samples / counted) * 100) : 0);
  const columns: DataTableColumn<CarrierFares>[] = [
    {
      key: "code",
      header: "Carrier",
      cell: (carrier) => (
        <span className="inline-flex items-center gap-2">
          <span className="inline-flex h-7 min-w-10 items-center justify-center rounded-[8px] bg-card-2 px-1.5 font-mono text-[13px] font-semibold text-ink">
            {carrier.code}
          </span>
          {carrier === cheapest && intel.carriers.length > 1 && <Badge tone="ok">Lowest median</Badge>}
        </span>
      ),
      sortValue: (carrier) => carrier.code,
    },
    {
      key: "samples",
      header: "Fares seen",
      align: "right",
      cell: (carrier) => carrier.samples.toLocaleString("en-US"),
      sortValue: (carrier) => carrier.samples,
    },
    {
      key: "share",
      header: "Share",
      align: "right",
      cell: (carrier) => (
        <span className="inline-flex items-center justify-end gap-2">
          <span aria-hidden="true" className="progress hidden h-1.5 w-16 sm:block">
            <i style={{ width: `${share(carrier)}%` }} />
          </span>
          <span className="w-9 text-right">{share(carrier)}%</span>
        </span>
      ),
      sortValue: (carrier) => carrier.samples,
    },
    {
      key: "median",
      header: "Median fare",
      align: "right",
      cell: (carrier) => <span className="font-mono tabular-nums">{money(carrier.median_minor, intel.currency)}</span>,
      sortValue: (carrier) => carrier.median_minor,
    },
  ];
  return (
    <Panel
      title="Carriers"
      description={`The ${plural(intel.carriers.length, "carrier")} seen most often · share of their fares`}
      icon={Plane}
      flush
      className={cn("overflow-hidden", className)}
    >
      {intel.carriers.length > 0 && (
        <ul aria-label={`Carriers on ${routeName(intel.origin, intel.destination)}`} className="list border-t border-line px-[18px] sm:hidden">
          {intel.carriers.map((carrier) => (
            <li key={carrier.code} className="li gap-3 px-0">
              <span className="inline-flex h-7 min-w-10 items-center justify-center rounded-[8px] bg-card-2 px-1.5 font-mono text-[13px] font-semibold text-ink">
                {carrier.code}
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-xs text-dim">
                  {plural(carrier.samples, "fare")} · {share(carrier)}%
                </span>
                {carrier === cheapest && intel.carriers.length > 1 && <span className="text-[11px] text-ok">Lowest median</span>}
              </span>
              <span className="font-mono text-[13px] tabular-nums text-ink">{money(carrier.median_minor, intel.currency)}</span>
            </li>
          ))}
        </ul>
      )}
      <DataTable
        className={intel.carriers.length > 0 ? "max-sm:hidden" : undefined}
        caption={`Carriers on ${routeName(intel.origin, intel.destination)}`}
        columns={columns}
        rows={intel.carriers}
        getRowId={(carrier) => carrier.code}
        emptyState={<p className="px-4 py-6 text-center text-[13px] text-dim">No carrier details on these fares.</p>}
      />
    </Panel>
  );
}

/** Searches listed before "Show all". */
const SEARCHES_SHOWN = 6;

/** The agency's own recent one-way, adults-only searches of the route, per traveller. */
export function SearchesPanel({ intel, cabin, now, className }: { intel: RouteIntel; cabin: Cabin; now: Date; className?: string }) {
  const median = latestDay(intel)?.median_minor;
  const [expanded, setExpanded] = useState(false);
  const total = intel.your_searches.length;
  const shown = expanded ? intel.your_searches : intel.your_searches.slice(0, SEARCHES_SHOWN);
  return (
    <Panel
      title="Your searches"
      icon={History}
      className={className}
      description={`Your agency's one-way searches of this route in ${intel.currency}, cheapest fare per traveller`}
    >
      {intel.your_searches.length === 0 ? (
        <div className="flex flex-col items-start gap-3">
          <p className="flex items-start gap-2 text-[13px] leading-5 text-dim">
            <History size={15} aria-hidden="true" className="mt-0.5 shrink-0 text-faint" />
            Nobody in your agency has searched this route yet. Each search is listed here with its cheapest fare.
          </p>
          <ScanFaresLink intel={intel} cabin={cabin} variant="secondary" />
        </div>
      ) : (
        <ul className="list -my-1">
          {shown.map((search, index) => {
            const pct = median === undefined ? null : changePct(search.cheapest_minor, median);
            return (
              <li
                key={`${index}-${search.created_at}`}
                className="li justify-between gap-3 px-0 py-2.5"
              >
                <span className="flex min-w-0 flex-col">
                  <time dateTime={search.created_at} title={formatDate(search.created_at)} className="text-[13px] text-ink">
                    {formatRelativeTime(search.created_at, now)}
                  </time>
                  <span className="text-xs text-dim">{plural(search.adults, "adult")}</span>
                </span>
                <span className="flex flex-col items-end">
                  <span className="font-mono text-[13px] tabular-nums text-ink">
                    {money(search.cheapest_minor, intel.currency)}
                    <span className="ml-1 font-sans text-xs text-dim">per traveller</span>
                  </span>
                  {pct !== null && (
                    <span className={cn("text-[11px] tabular-nums", pct <= 0 ? "text-ok" : "text-dim")}>
                      {Math.abs(pct) < 0.5 ? "At" : `${Math.round(Math.abs(pct))}% ${pct < 0 ? "below" : "above"}`} median now
                    </span>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {total > SEARCHES_SHOWN && (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((open) => !open)}
          className="mt-3 rounded-sm text-[13px] font-medium text-primary underline-offset-2 hover:underline"
        >
          {expanded ? "Show fewer" : `Show all ${total} searches`}
        </button>
      )}
    </Panel>
  );
}

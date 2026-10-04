import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { ChevronDown, Plus, Search, SearchX, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { enquiriesQueryOptions, type EnquiryOut, type EnquiryStatus } from "../../api/enquiries";
import { teamQueryOptions } from "../../api/queries";
import { quotesQueryOptions, type QuoteSummary } from "../../api/quotes";
import { useCurrentUser } from "../../auth/useCurrentUser";
import { formatNumber } from "../../lib/format";
import { formatMoneyCompact, formatWholeMoney } from "../../lib/money";
import { useDebouncedValue } from "../../lib/useDebouncedValue";
import { useClock } from "../../shell/useClock";
import { Avatar } from "../../ui/Avatar";
import { Button } from "../../ui/Button";
import { KpiStrip, KpiTile } from "../../ui/charts";
import { cn } from "../../ui/cn";
import { DataTable, type DataTableColumn } from "../../ui/DataTable";
import { EmptyState } from "../../ui/EmptyState";
import { PageHeader } from "../../ui/PageHeader";
import { SegmentedControl } from "../../ui/SegmentedControl";
import { StatusPill } from "../../ui/StatusPill";
import { FIELD_LABEL } from "../../ui/TextField";
import { NewEnquiryDialog } from "../command/NewEnquiryDialog";
import { PanelError } from "../command/PanelError";
import { EnquiryCard } from "./EnquiryCard";
import {
  ageDescription,
  ageLabel,
  canMove,
  latestQuotes,
  quotedValue,
  routeLabel,
  STAGES,
  stageLabel,
  travellerCount,
  tripDates,
} from "./enquiryFacts";
import { MoveMenu } from "./MoveMenu";
import { PipelineColumn, PipelineColumnSkeleton, type DropState } from "./PipelineColumn";
import { useEnquiryMove } from "./useEnquiryMove";

/** The board shows up to this many enquiries (the API's page limit), newest first. */
const BOARD_LIMIT = 200;
const OPEN: readonly EnquiryStatus[] = ["new", "quoting", "quoted"];
const VIEWS = [
  { value: "board", label: "Board" },
  { value: "list", label: "List" },
] as const;
type View = (typeof VIEWS)[number]["value"];
const SKELETON_CARDS: Record<EnquiryStatus, number> = { new: 3, quoting: 2, quoted: 2, won: 1, lost: 1 };

const COMPACT_SELECT = cn(
  "h-8 min-w-0 cursor-pointer appearance-none rounded-md border border-line-strong bg-surface-2 pl-2.5 pr-8 text-[13px] text-ink",
  "transition-colors duration-150 ease-tm hover:border-faint focus:border-primary",
);

const routeKey = (enquiry: Pick<EnquiryOut, "origin" | "destination">) =>
  enquiry.origin && enquiry.destination ? `${enquiry.origin}-${enquiry.destination}` : null;

function CompactSelect({ label, value, onChange, children }: { label: string; value: string; onChange: (value: string) => void; children: ReactNode }) {
  const id = useId();
  return (
    <div className="flex min-w-0 items-center gap-2 max-sm:basis-[calc(50%-0.5rem)]">
      <label htmlFor={id} className={cn(FIELD_LABEL, "shrink-0 text-dim max-sm:sr-only")}>
        {label}
      </label>
      <div className="relative min-w-0 max-sm:flex-1">
        <select id={id} value={value} onChange={(event) => onChange(event.target.value)} className={cn(COMPACT_SELECT, "w-full sm:w-auto sm:max-w-52")}>
          {children}
        </select>
        <ChevronDown size={14} aria-hidden="true" className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-dim" />
      </div>
    </div>
  );
}

type Figures = {
  byStage: Record<EnquiryStatus, EnquiryOut[]>;
  value: Record<EnquiryStatus, number>;
  avgAgeMs: Record<EnquiryStatus, number | null>;
};

function figuresOf(items: readonly EnquiryOut[], latest: Map<string, QuoteSummary>, currency: string, now: Date): Figures {
  const byStage = { new: [], quoting: [], quoted: [], won: [], lost: [] } as Record<EnquiryStatus, EnquiryOut[]>;
  for (const item of items) byStage[item.status].push(item);
  const value = {} as Record<EnquiryStatus, number>;
  const avgAgeMs = {} as Record<EnquiryStatus, number | null>;
  for (const status of STAGES) {
    const stage = byStage[status];
    value[status] = stage.reduce((sum, item) => sum + quotedValue(latest.get(item.id), currency), 0);
    avgAgeMs[status] =
      stage.length > 0 ? stage.reduce((sum, item) => sum + (now.getTime() - new Date(item.created_at).getTime()), 0) / stage.length : null;
  }
  return { byStage, value, avgAgeMs };
}

function PipelineKpis({ figures, currency, loading, now }: { figures: Figures; currency: string; loading: boolean; now: Date }) {
  const { byStage, value } = figures;
  const open = OPEN.flatMap((status) => byStage[status]);
  const openValue = OPEN.reduce((sum, status) => sum + value[status], 0);
  const won = byStage.won.length;
  const lost = byStage.lost.length;
  const closed = won + lost;
  const oldest = open.reduce<EnquiryOut | null>((first, item) => (!first || item.created_at < first.created_at ? item : first), null);
  const money = (minor: number) => formatMoneyCompact({ amount_minor: minor, currency });
  const winRate = closed > 0 ? `${Math.round((won / closed) * 100)}%` : "—";
  return (
    <>
      {/* Phones: the headline figures on one line, so the board starts above the fold. */}
      <dl
        aria-label="Pipeline summary"
        aria-busy={loading || undefined}
        className="mb-3 grid grid-cols-3 divide-x divide-line rounded-lg border border-line bg-surface sm:hidden"
      >
        {[
          ["Open", formatNumber(open.length)],
          ["Open value", money(openValue)],
          ["Win rate", winRate],
        ].map(([label, figure]) => (
          <div key={label} className="flex min-w-0 flex-col gap-0.5 px-3 py-2">
            <dt className="tm-micro truncate">{label}</dt>
            <dd className="tm-num truncate text-base font-medium text-ink">{loading ? "…" : figure}</dd>
          </div>
        ))}
      </dl>
      <KpiStrip label="Pipeline totals" columns={5} busy={loading} className="mb-4 max-sm:hidden">
        <KpiTile
          label="Open enquiries"
          value={formatNumber(open.length)}
          hint={`${byStage.new.length} new · ${byStage.quoting.length} quoting · ${byStage.quoted.length} quoted`}
          loading={loading}
        />
        <KpiTile label="Open value" value={money(openValue)} hint="Latest quote of each open enquiry" loading={loading} />
        <KpiTile label="Won value" value={money(value.won)} hint={`${formatNumber(won)} enquir${won === 1 ? "y" : "ies"} won`} loading={loading} />
        <KpiTile
          label="Win rate"
          value={winRate}
          hint={closed > 0 ? `${won} won · ${lost} lost` : "No closed enquiries yet"}
          loading={loading}
        />
        <KpiTile
          label="Oldest open"
          value={oldest ? ageLabel(oldest.created_at, now) : "—"}
          hint={oldest ? `${oldest.number} · ${routeLabel(oldest)}` : "Nothing waiting"}
          loading={loading}
        />
      </KpiStrip>
    </>
  );
}

/** Small screens show one stage at a time: this picks it, with each stage's count. */
function StagePicker({ value, onChange, counts }: { value: EnquiryStatus; onChange: (status: EnquiryStatus) => void; counts: Record<EnquiryStatus, number> }) {
  return (
    <div role="group" aria-label="Stage to show" className="mb-3 grid grid-cols-5 gap-1 rounded-md border border-line-strong bg-surface-2 p-0.5 lg:hidden">
      {STAGES.map((status) => {
        const selected = status === value;
        return (
          <button
            key={status}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(status)}
            className={cn(
              "flex min-w-0 flex-col items-center rounded-[4px] border px-1 py-1 transition-colors duration-150 ease-tm",
              selected ? "border-line-strong bg-surface text-ink shadow-raise" : "border-transparent text-dim hover:text-ink",
            )}
          >
            <span className="w-full truncate text-center text-xs font-medium leading-4">{stageLabel(status)}</span>
            <span className="font-mono text-[11px] leading-4 tabular-nums">
              {counts[status]}
              <span className="sr-only"> {counts[status] === 1 ? "enquiry" : "enquiries"}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** Where a move just landed an enquiry; keyboard focus follows it there. */
type Placed = { id: string; status: EnquiryStatus };

/**
 * The list view's Enquiry cell. After a move lands this row's enquiry in its new stage, it puts focus
 * on the row if the move took it away: the row's Move menu keeps focus, unless the enquiry now has no
 * moves (won) and the menu is gone.
 */
function RowNumber({ enquiry, placed, onSettled }: { enquiry: EnquiryOut; placed: Placed | null; onSettled: () => void }) {
  const ref = useRef<HTMLSpanElement>(null);
  const due = placed?.id === enquiry.id && placed.status === enquiry.status;
  useEffect(() => {
    if (!due) return;
    const active = document.activeElement;
    if (!active || active === document.body) ref.current?.closest("tr")?.focus();
    onSettled();
  }, [due, onSettled]);
  return (
    <span ref={ref} className="font-mono text-[13px] text-ink">
      {enquiry.number}
    </span>
  );
}

export function PipelinePage() {
  const me = useCurrentUser();
  const currency = me?.agency.currency ?? "INR";
  const navigate = useNavigate();
  const now = useClock(60_000);
  const [view, setView] = useState<View>("board");
  const [assignee, setAssignee] = useState("");
  const [term, setTerm] = useState("");
  const [route, setRoute] = useState("");
  const [stage, setStage] = useState<EnquiryStatus>("new");
  const [dragging, setDragging] = useState<EnquiryOut | null>(null);
  const [creating, setCreating] = useState(false);
  const q = useDebouncedValue(term.trim(), 250);
  const [placed, setPlaced] = useState<Placed | null>(null);
  const { move, dialog } = useEnquiryMove({
    onPlaced: (id, status) => {
      // On phones the board shows one stage: follow the card there.
      setStage(status);
      setPlaced({ id, status });
    },
  });
  const settlePlaced = () => setPlaced(null);

  const enquiries = useQuery(enquiriesQueryOptions({ limit: BOARD_LIMIT, assignee: assignee || undefined, q: q || undefined }));
  const quotes = useQuery(quotesQueryOptions({ limit: BOARD_LIMIT }));
  const team = useQuery(teamQueryOptions);

  const latest = useMemo(() => latestQuotes(quotes.data?.items ?? []), [quotes.data]);
  const all = useMemo(() => enquiries.data?.items ?? [], [enquiries.data]);
  const routes = useMemo(() => {
    const keys = new Set<string>();
    for (const item of all) {
      const key = routeKey(item);
      if (key) keys.add(key);
    }
    if (route) keys.add(route);
    return [...keys].sort();
  }, [all, route]);
  const items = useMemo(() => (route ? all.filter((item) => routeKey(item) === route) : all), [all, route]);
  const figures = useMemo(() => figuresOf(items, latest, currency, now), [items, latest, currency, now]);

  const loading = enquiries.isPending;
  const filtered = Boolean(assignee || q || route);
  const total = enquiries.data?.total ?? 0;
  const truncated = total > all.length;

  function dropStateFor(status: EnquiryStatus): DropState {
    if (!dragging) return "idle";
    if (dragging.status === status) return "idle";
    return canMove(dragging.status, status) ? "allowed" : "blocked";
  }

  function clearFilters() {
    setAssignee("");
    setTerm("");
    setRoute("");
  }

  const columns: DataTableColumn<EnquiryOut>[] = [
    {
      key: "number",
      header: "Enquiry",
      cell: (row) => <RowNumber enquiry={row} placed={placed} onSettled={settlePlaced} />,
      sortValue: (row) => row.number,
    },
    {
      key: "route",
      header: "Route",
      cell: (row) => <span className="whitespace-nowrap font-mono text-[13px] font-medium">{routeLabel(row)}</span>,
      sortValue: (row) => routeLabel(row),
    },
    {
      key: "client",
      header: "Client",
      cell: (row) => <span className={row.client ? "text-ink" : "text-faint"}>{row.client?.name ?? "No client"}</span>,
      sortValue: (row) => row.client?.name ?? "",
    },
    {
      key: "status",
      header: "Stage",
      cell: (row) => <StatusPill status={row.status} />,
      sortValue: (row) => STAGES.indexOf(row.status),
    },
    {
      key: "dates",
      header: "Travel",
      cell: (row) => <span className="whitespace-nowrap text-dim">{tripDates(row) ?? "—"}</span>,
      sortValue: (row) => row.depart_date ?? "9999",
    },
    { key: "pax", header: "Pax", align: "right", cell: (row) => travellerCount(row), sortValue: (row) => travellerCount(row) },
    {
      key: "assignee",
      header: "Assignee",
      cell: (row) =>
        row.assignee ? (
          <span className="flex items-center gap-2 whitespace-nowrap">
            <Avatar name={row.assignee.full_name} size="sm" />
            <span className="text-dim">{row.assignee.full_name}</span>
          </span>
        ) : (
          <span className="text-faint">Unassigned</span>
        ),
      sortValue: (row) => row.assignee?.full_name ?? "",
    },
    {
      key: "quote",
      header: "Latest quote",
      align: "right",
      cell: (row) => {
        const quote = latest.get(row.id);
        return quote && quote.min_sell_minor !== null ? formatWholeMoney(quote.min_sell_minor, quote.currency) : "—";
      },
      sortValue: (row) => latest.get(row.id)?.min_sell_minor ?? -1,
    },
    {
      key: "age",
      header: "Age",
      align: "right",
      cell: (row) => <span title={ageDescription(row.created_at, now)}>{ageLabel(row.created_at, now)}</span>,
      sortValue: (row) => -new Date(row.created_at).getTime(),
    },
  ];

  const nothingAtAll = !loading && !enquiries.isError && items.length === 0;

  return (
    <>
      <PageHeader
        breadcrumb={[{ label: "Workspace", to: "/app" }, { label: "Pipeline" }]}
        title="Pipeline"
        description="Every enquiry by stage, from first request to won or lost. Drag a card, or use its Move menu."
        actions={
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus size={15} aria-hidden="true" />
            New enquiry
          </Button>
        }
      />

      <PipelineKpis figures={figures} currency={currency} loading={loading} now={now} />

      <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2.5 rounded-lg border border-line bg-surface px-3 py-2.5">
        <div className="relative w-full min-w-0 sm:w-64">
          <Search size={14} aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
          <input
            type="search"
            aria-label="Search enquiries"
            placeholder="Number, route, client or notes"
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            className="h-8 w-full rounded-md border border-line-strong bg-surface-2 pl-8 pr-2.5 text-[13px] text-ink placeholder:text-faint transition-colors duration-150 ease-tm hover:border-faint focus:border-primary"
          />
        </div>
        <CompactSelect label="Assignee" value={assignee} onChange={setAssignee}>
          <option value="">Everyone</option>
          {me && <option value={me.user.id}>Me ({me.user.full_name})</option>}
          {(team.data ?? [])
            .filter((member) => member.id !== me?.user.id)
            .map((member) => (
              <option key={member.id} value={member.id}>
                {member.full_name}
              </option>
            ))}
        </CompactSelect>
        <CompactSelect label="Route" value={route} onChange={setRoute}>
          <option value="">All routes</option>
          {routes.map((key) => (
            <option key={key} value={key}>
              {key.replace("-", " → ")}
            </option>
          ))}
        </CompactSelect>
        {filtered && (
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            <X size={14} aria-hidden="true" />
            Clear filters
          </Button>
        )}
        <div className="flex w-full items-center justify-between gap-3 sm:ml-auto sm:w-auto sm:justify-start">
          <p className="font-mono text-xs tabular-nums text-dim" aria-live="polite">
            {loading ? "Loading…" : `${formatNumber(items.length)} enquir${items.length === 1 ? "y" : "ies"}`}
          </p>
          <SegmentedControl label="View" options={VIEWS} value={view} onChange={setView} />
        </div>
      </div>

      {truncated && (
        <p className="mb-3 text-xs text-dim">
          Showing the {formatNumber(all.length)} newest of {formatNumber(total)} enquiries. Search or filter to find older ones.
        </p>
      )}

      {enquiries.isError ? (
        <PanelError error={enquiries.error} onRetry={() => void enquiries.refetch()} retrying={enquiries.isFetching} />
      ) : nothingAtAll && filtered ? (
        <div className="rounded-lg border border-line bg-surface">
          <EmptyState
            icon={SearchX}
            title="No enquiries match these filters"
            description="Try another name, route or teammate, or clear the filters to see the whole pipeline."
            action={{ label: "Clear filters", onClick: clearFilters }}
          />
        </div>
      ) : view === "list" ? (
        <div className="rounded-lg border border-line bg-surface">
          <DataTable
            caption="Enquiries"
            columns={columns}
            rows={items}
            getRowId={(row) => row.id}
            loading={loading}
            onRowClick={(row) => void navigate({ to: "/app/enquiries/$enquiryId", params: { enquiryId: row.id } })}
            rowActions={(row) => <MoveMenu enquiry={row} onMove={(to) => move(row, to)} />}
            emptyState={
              <EmptyState
                icon={SearchX}
                title="No enquiries yet"
                description="Capture a client's trip request to start your pipeline."
                action={{ label: "New enquiry", onClick: () => setCreating(true) }}
              />
            }
          />
        </div>
      ) : (
        <>
          <StagePicker
            value={stage}
            onChange={setStage}
            counts={{
              new: figures.byStage.new.length,
              quoting: figures.byStage.quoting.length,
              quoted: figures.byStage.quoted.length,
              won: figures.byStage.won.length,
              lost: figures.byStage.lost.length,
            }}
          />
          <div
            aria-busy={loading || undefined}
            className="grid grid-cols-1 gap-3 lg:grid-cols-[repeat(5,minmax(13.5rem,1fr))] lg:overflow-x-auto lg:pb-2"
          >
            {loading
              ? STAGES.map((status) => (
                  <PipelineColumnSkeleton key={status} status={status} cards={SKELETON_CARDS[status]} hiddenOnSmall={status !== stage} />
                ))
              : STAGES.map((status) => {
                  const cards = figures.byStage[status];
                  const avg = figures.avgAgeMs[status];
                  return (
                    <PipelineColumn
                      key={status}
                      status={status}
                      count={cards.length}
                      value={figures.value[status] > 0 ? formatWholeMoney(figures.value[status], currency) : null}
                      note={avg !== null && cards.length > 0 ? `avg ${ageLabel(new Date(now.getTime() - avg).toISOString(), now)}` : undefined}
                      drop={dropStateFor(status)}
                      onDropCard={() => {
                        if (dragging) move(dragging, status);
                        setDragging(null);
                      }}
                      onNewEnquiry={status === "new" && !filtered ? () => setCreating(true) : undefined}
                      hiddenOnSmall={status !== stage}
                    >
                      {cards.map((enquiry) => (
                        <li key={enquiry.id}>
                          <EnquiryCard
                            enquiry={enquiry}
                            latest={latest.get(enquiry.id)}
                            now={now}
                            onMove={(to) => move(enquiry, to)}
                            dragging={dragging?.id === enquiry.id}
                            onDragStart={() => setDragging(enquiry)}
                            onDragEnd={() => setDragging(null)}
                            focusRequested={placed?.id === enquiry.id && placed.status === enquiry.status}
                            onFocused={settlePlaced}
                          />
                        </li>
                      ))}
                    </PipelineColumn>
                  );
                })}
          </div>
        </>
      )}

      {dialog}
      <NewEnquiryDialog open={creating} onClose={() => setCreating(false)} />
    </>
  );
}

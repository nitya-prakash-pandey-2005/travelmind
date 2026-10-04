import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { FilePlus2, FileText, Plane, Search, SearchX, Send, SquareKanban, X } from "lucide-react";
import { useMemo, useState } from "react";
import { quotesQueryOptions, type QuoteStatus, type QuoteSummary } from "../../api/quotes";
import { useCurrentUser } from "../../auth/useCurrentUser";
import { formatDate, formatNumber, formatRelativeTime } from "../../lib/format";
import { formatMoneyCompact, formatWholeMoney } from "../../lib/money";
import { useClock } from "../../shell/useClock";
import { Button, buttonClasses } from "../../ui/Button";
import { KpiStrip, KpiTile } from "../../ui/charts";
import { cn } from "../../ui/cn";
import { DataTable, type DataTableColumn } from "../../ui/DataTable";
import { EmptyState } from "../../ui/EmptyState";
import { PageHeader } from "../../ui/PageHeader";
import { Panel } from "../../ui/Panel";
import { STATUS_PILL, StatusPill } from "../../ui/StatusPill";
import { Tabs } from "../../ui/Tabs";
import { PanelError } from "../command/PanelError";
import { NewQuoteDialog } from "./NewQuoteDialog";
import { routeLabel } from "../pipeline/enquiryFacts";

/** The list shows up to this many quotes (the API's page limit), newest first. */
const LIST_LIMIT = 200;
const STATUSES: readonly QuoteStatus[] = ["draft", "sent", "viewed", "accepted", "declined", "expired"];
type Tab = QuoteStatus | "all";

const SEARCH_INPUT = cn(
  "h-8 w-full rounded-md border border-line-strong bg-surface-2 pl-8 pr-2.5 text-[13px] text-ink placeholder:text-faint",
  "transition-colors duration-150 ease-tm hover:border-faint focus:border-primary",
);

/** "v3 · sent v2", "v1", or "—" before the first version. */
function versionsLabel(quote: Pick<QuoteSummary, "current_version" | "sent_version">): string {
  if (quote.current_version === 0) return "—";
  return quote.sent_version ? `v${quote.current_version} · sent v${quote.sent_version}` : `v${quote.current_version}`;
}

function matches(quote: QuoteSummary, term: string): boolean {
  if (!term) return true;
  const haystack = [quote.number, quote.client?.name, quote.enquiry.number, quote.enquiry.origin, quote.enquiry.destination, routeLabel(quote.enquiry)]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes(term.toLowerCase());
}

type Figures = { counts: Record<QuoteStatus, number>; acceptedValue: number; awaitingValue: number };

function figuresOf(items: readonly QuoteSummary[], currency: string): Figures {
  const counts = { draft: 0, sent: 0, viewed: 0, accepted: 0, declined: 0, expired: 0 } as Record<QuoteStatus, number>;
  let acceptedValue = 0;
  let awaitingValue = 0;
  for (const quote of items) {
    counts[quote.status] += 1;
    const value = quote.currency === currency ? (quote.min_sell_minor ?? 0) : 0;
    if (quote.status === "accepted") acceptedValue += value;
    if (quote.status === "sent" || quote.status === "viewed") awaitingValue += value;
  }
  return { counts, acceptedValue, awaitingValue };
}

const pct = (part: number, whole: number) => (whole > 0 ? `${Math.round((part / whole) * 100)}%` : "—");

function QuoteFigures({ figures, currency, loading }: { figures: Figures; currency: string; loading: boolean }) {
  const { counts } = figures;
  const open = counts.draft + counts.sent + counts.viewed;
  const awaiting = counts.sent + counts.viewed;
  const sentEver = counts.sent + counts.viewed + counts.accepted + counts.declined + counts.expired;
  const opened = counts.viewed + counts.accepted + counts.declined;
  const decided = counts.accepted + counts.declined + counts.expired;
  const money = (minor: number) => formatMoneyCompact({ amount_minor: minor, currency });
  return (
    <KpiStrip label="Quote figures" columns={5} busy={loading} className="mb-4">
      <KpiTile
        label="Open quotes"
        value={formatNumber(open)}
        hint={`${counts.draft} draft · ${counts.sent} sent · ${counts.viewed} viewed`}
        loading={loading}
      />
      <KpiTile
        label="Awaiting the client"
        value={formatNumber(awaiting)}
        hint={awaiting > 0 ? `${money(figures.awaitingValue)} at the cheapest options` : "Nothing waiting on a client"}
        loading={loading}
      />
      <KpiTile
        label="Open rate"
        value={pct(opened, sentEver)}
        hint={sentEver > 0 ? `${opened} of ${sentEver} sent quotes opened` : "No quotes sent yet"}
        loading={loading}
      />
      <KpiTile
        label="Acceptance rate"
        value={pct(counts.accepted, decided)}
        hint={decided > 0 ? `${counts.accepted} of ${decided} decided quotes` : "No decisions yet"}
        loading={loading}
      />
      <KpiTile
        label="Accepted quotes"
        value={formatNumber(counts.accepted)}
        hint={counts.accepted > 0 ? `${money(figures.acceptedValue)} at their cheapest options` : "None accepted yet"}
        loading={loading}
      />
    </KpiStrip>
  );
}

const STEPS = [
  {
    icon: Plane,
    title: "Search live fares",
    text: "Open a quote from an enquiry and search every connected supplier for the client's trip.",
  },
  {
    icon: FileText,
    title: "Save priced versions",
    text: "Pick up to three offers and set your markup. TravelMind prices each option and keeps every version.",
  },
  {
    icon: Send,
    title: "Share one link",
    text: "Send the link or a ready WhatsApp message. You see when the client opens, accepts or declines it.",
  },
];

function HowQuotingWorks() {
  return (
    <Panel title="How quoting works" description="From a client's enquiry to an accepted quote">
      <ol className="grid gap-4 sm:grid-cols-3">
        {STEPS.map(({ icon: Icon, title, text }, index) => (
          <li key={title} className="flex gap-3">
            <span
              aria-hidden="true"
              className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-line bg-surface-2 text-dim"
            >
              <Icon size={15} strokeWidth={1.75} />
            </span>
            <div className="min-w-0">
              <p className="text-[13px] font-medium leading-5 text-ink">
                <span className="tm-num mr-1.5 text-faint">{index + 1}</span>
                {title}
              </p>
              <p className="mt-0.5 text-xs leading-4 text-dim">{text}</p>
            </div>
          </li>
        ))}
      </ol>
    </Panel>
  );
}

/** Phones: each quote as a two-line row instead of the wide table. */
function QuoteCards({ rows, now }: { rows: readonly QuoteSummary[]; now: Date }) {
  return (
    <ul aria-label="Quotes" className="flex flex-col sm:hidden">
      {rows.map((q) => (
        <li key={q.id} className="border-b border-line last:border-b-0">
          <Link
            to="/app/quotes/$quoteId"
            params={{ quoteId: q.id }}
            className="flex flex-col gap-1 px-3 py-2.5 transition-colors duration-150 ease-tm hover:bg-hover"
          >
            <span className="flex items-center gap-2">
              <span className="font-mono text-[13px] text-ink">{q.number}</span>
              <StatusPill status={q.status} />
              <span className="ml-auto font-mono text-[13px] tabular-nums text-ink">
                {q.min_sell_minor !== null ? formatWholeMoney(q.min_sell_minor, q.currency) : "—"}
              </span>
            </span>
            <span className="flex flex-wrap items-center gap-x-1.5 text-xs text-dim">
              <span className={q.client ? "text-ink" : "text-faint"}>{q.client?.name ?? "No client"}</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono">{routeLabel(q.enquiry)}</span>
              <span aria-hidden="true">·</span>
              <span>{versionsLabel(q)}</span>
              <span aria-hidden="true">·</span>
              <span>{q.sent_at ? `Sent ${formatRelativeTime(q.sent_at, now)}` : "Not sent"}</span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** Every quote the agency built or sent: figures, status tabs, search and the table. */
export function QuotesPage() {
  const me = useCurrentUser();
  const currency = me?.agency.currency ?? "INR";
  const navigate = useNavigate();
  const now = useClock(60_000);
  const [tab, setTab] = useState<Tab>("all");
  const [term, setTerm] = useState("");
  const [creating, setCreating] = useState(false);

  const all = useQuery(quotesQueryOptions({ limit: LIST_LIMIT }));
  const filtered = useQuery({ ...quotesQueryOptions({ status: tab === "all" ? undefined : tab, limit: LIST_LIMIT }), enabled: tab !== "all" });
  const source = tab === "all" ? all : filtered;

  const figures = useMemo(() => figuresOf(all.data?.items ?? [], currency), [all.data, currency]);
  const needle = term.trim();
  const rows = useMemo(() => (source.data?.items ?? []).filter((quote) => matches(quote, needle)), [source.data, needle]);
  const total = all.data?.total ?? 0;
  const currencies = useMemo(() => [...new Set(rows.map((quote) => quote.currency))], [rows]);
  const nothingYet = !all.isPending && !all.isError && total === 0;

  const tabs = [
    { id: "all", label: `All ${all.data ? formatNumber(total) : ""}`.trim() },
    ...STATUSES.map((status) => ({
      id: status,
      label: `${STATUS_PILL[status].label} ${all.data ? figures.counts[status] : ""}`.trim(),
    })),
  ];

  const columns: DataTableColumn<QuoteSummary>[] = [
    {
      key: "number",
      header: "Number",
      cell: (q) => <span className="font-mono text-[13px] text-ink">{q.number}</span>,
      sortValue: (q) => q.number,
    },
    {
      key: "client",
      header: "Client",
      cell: (q) => <span className={q.client ? "whitespace-nowrap text-ink" : "text-faint"}>{q.client?.name ?? "No client"}</span>,
      sortValue: (q) => q.client?.name ?? "",
    },
    {
      key: "route",
      header: "Route",
      cell: (q) => (
        <span className="flex flex-col whitespace-nowrap leading-4">
          <span className="font-mono text-[13px] font-medium text-ink">{routeLabel(q.enquiry)}</span>
          <span className="text-[11px] text-dim">
            {q.enquiry.number}
            {q.enquiry.depart_date ? ` · ${formatDate(q.enquiry.depart_date)}` : ""}
          </span>
        </span>
      ),
      sortValue: (q) => routeLabel(q.enquiry),
    },
    {
      key: "status",
      header: "Status",
      cell: (q) => <StatusPill status={q.status} />,
      sortValue: (q) => STATUSES.indexOf(q.status),
    },
    {
      key: "value",
      header: "Value",
      align: "right",
      cell: (q) => (q.min_sell_minor !== null ? formatWholeMoney(q.min_sell_minor, q.currency) : <span className="text-faint">—</span>),
      sortValue: (q) => q.min_sell_minor ?? -1,
    },
    {
      key: "versions",
      header: "Versions",
      align: "right",
      cell: (q) => <span className="whitespace-nowrap">{versionsLabel(q)}</span>,
      sortValue: (q) => q.current_version,
    },
    {
      key: "sent",
      header: "Sent",
      cell: (q) =>
        q.sent_at ? (
          <time dateTime={q.sent_at} title={formatDate(q.sent_at)} className="whitespace-nowrap text-dim">
            {formatRelativeTime(q.sent_at, now)}
          </time>
        ) : (
          <span className="whitespace-nowrap text-faint">Not sent</span>
        ),
      sortValue: (q) => q.sent_at ?? "",
    },
    {
      key: "created",
      header: "Created",
      cell: (q) => (
        <time dateTime={q.created_at} title={formatDate(q.created_at)} className="whitespace-nowrap text-dim">
          {formatRelativeTime(q.created_at, now)}
        </time>
      ),
      sortValue: (q) => q.created_at,
    },
  ];

  const emptyFiltered = needle ? (
    <EmptyState
      icon={SearchX}
      title={`No quotes match “${needle}”`}
      description="Search by quote or enquiry number, client or airport code."
      action={{ label: "Clear search", onClick: () => setTerm("") }}
    />
  ) : (
    <EmptyState
      icon={FileText}
      title={tab === "all" ? "No quotes yet" : `No ${STATUS_PILL[tab].label.toLowerCase()} quotes`}
      description={tab === "all" ? "Quotes start from an enquiry." : "Quotes appear here as they reach this status."}
    />
  );

  return (
    <>
      <PageHeader
        breadcrumb={[{ label: "Workspace", to: "/app" }, { label: "Quotes" }]}
        title="Quotes"
        description="Every quote you've built or sent, with its status, value and versions. Select a row to edit, price or send it."
        actions={
          <Button size="sm" onClick={() => setCreating(true)}>
            <FilePlus2 size={14} aria-hidden="true" />
            New quote
          </Button>
        }
      />

      <QuoteFigures figures={figures} currency={currency} loading={all.isPending} />

      {all.isError ? (
        <PanelError error={all.error} onRetry={() => void all.refetch()} retrying={all.isFetching} />
      ) : nothingYet ? (
        <div className="flex flex-col gap-4">
          <div className="rounded-lg border border-line bg-surface">
            <EmptyState
              icon={FileText}
              title="No quotes yet"
              description="Quotes start from an enquiry: open one in the pipeline and choose Create quote, or start one here with New quote."
              action={{ label: "Open pipeline", to: "/app/pipeline" }}
            />
          </div>
          <HowQuotingWorks />
        </div>
      ) : (
        <section aria-label="Quote list" className="rounded-lg border border-line bg-surface">
          <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2 border-b border-line px-3 pt-1">
            <Tabs tabs={tabs} value={tab} onChange={(id) => setTab(id as Tab)} label="Quote status" className="-mb-px border-b-0" />
            <div className="flex w-full items-center gap-3 pb-2 sm:w-auto">
              <div className="relative min-w-0 flex-1 sm:w-60 sm:flex-none">
                <Search size={14} aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
                <input
                  type="search"
                  aria-label="Search quotes"
                  placeholder="Number, client or route"
                  value={term}
                  onChange={(event) => setTerm(event.target.value)}
                  className={SEARCH_INPUT}
                />
              </div>
              {needle && (
                <Button variant="ghost" size="sm" iconOnly aria-label="Clear search" onClick={() => setTerm("")}>
                  <X size={14} aria-hidden="true" />
                </Button>
              )}
              <p className="shrink-0 font-mono text-xs tabular-nums text-dim" aria-live="polite">
                {source.isPending ? "Loading…" : `${formatNumber(rows.length)} quote${rows.length === 1 ? "" : "s"}`}
              </p>
            </div>
          </div>
          {source.isError ? (
            <div className="p-3">
              <PanelError error={source.error} onRetry={() => void source.refetch()} retrying={source.isFetching} />
            </div>
          ) : (
            <>
            {!source.isPending && rows.length > 0 && <QuoteCards rows={rows} now={now} />}
            <DataTable
              className={rows.length > 0 ? "max-sm:hidden" : undefined}
              caption="Quotes"
              columns={columns}
              rows={rows}
              getRowId={(q) => q.id}
              loading={source.isPending}
              onRowClick={(q) => void navigate({ to: "/app/quotes/$quoteId", params: { quoteId: q.id } })}
              emptyState={emptyFiltered}
            />
            </>
          )}
          {total > (all.data?.items.length ?? 0) && (
            <p className="border-t border-line px-3 py-2 text-xs text-dim">
              Showing the {formatNumber(all.data?.items.length ?? 0)} newest of {formatNumber(total)} quotes. Search looks
              through these rows only; a status tab loads the newest {formatNumber(LIST_LIMIT)} with that status.
            </p>
          )}
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-3 py-2 text-xs text-dim">
            <span>
              Values are each quote's cheapest option in its latest version, in whole{" "}
              {currencies.length === 1 ? currencies[0] : "units of each quote's own currency"}.
              {currencies.some((code) => code !== currency) && ` The figures above count ${currency} quotes only.`}
            </span>
            <Link to="/app/pipeline" className={buttonClasses({ variant: "ghost", size: "sm", className: "-my-1 h-7" })}>
              <SquareKanban size={13} aria-hidden="true" />
              Pipeline
            </Link>
          </div>
        </section>
      )}
      {creating && <NewQuoteDialog onClose={() => setCreating(false)} />}
    </>
  );
}

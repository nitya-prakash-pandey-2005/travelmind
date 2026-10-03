import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { FilePlus2, FileText, Pencil, Plane, SearchX } from "lucide-react";
import { useState, type ReactNode } from "react";
import { asApiError } from "../../api/client";
import { enquiryQueryOptions, type EnquiryOut } from "../../api/enquiries";
import { quotesQueryOptions, useCreateQuote, type QuoteSummary } from "../../api/quotes";
import { isoDateFromNow } from "../../lib/dates";
import { formatDate, formatNumber, formatRelativeTime } from "../../lib/format";
import { useClock } from "../../shell/useClock";
import { Avatar } from "../../ui/Avatar";
import { Button, buttonClasses } from "../../ui/Button";
import { KpiStrip, KpiTile } from "../../ui/charts";
import { DataTable, type DataTableColumn } from "../../ui/DataTable";
import { EmptyState } from "../../ui/EmptyState";
import { PageHeader } from "../../ui/PageHeader";
import { Panel } from "../../ui/Panel";
import { Skeleton } from "../../ui/Skeleton";
import { StatusPill } from "../../ui/StatusPill";
import { useToast } from "../../ui/toast/useToast";
import { PanelError } from "../command/PanelError";
import { validateFareSearch, type FareSearchParams } from "../fares/fareSearchParams";
import {
  ageDescription,
  ageLabel,
  cabinLabel,
  formatWholeMoney,
  latestQuotes,
  routeLabel,
  travellersLabel,
  tripDates,
} from "../pipeline/enquiryFacts";
import { MoveMenu } from "../pipeline/MoveMenu";
import { useEnquiryMove } from "../pipeline/useEnquiryMove";
import { EditEnquiryDrawer } from "./EditEnquiryDrawer";
import { EnquiryTimeline } from "./EnquiryTimeline";

const CRUMBS = [{ label: "Pipeline", to: "/app/pipeline" as const }];
const SOURCE_LABEL: Record<string, string> = { manual: "Entered by hand", pasted: "Pasted message", copilot: "Copilot" };

/** Fare search's address for this trip; only the parts the enquiry has. */
function fareSearch(enquiry: EnquiryOut): FareSearchParams {
  const cabin = validateFareSearch({ cabin: enquiry.cabin }).cabin;
  return {
    ...(enquiry.origin ? { origin: enquiry.origin } : {}),
    ...(enquiry.destination ? { destination: enquiry.destination } : {}),
    ...(enquiry.depart_date ? { depart: enquiry.depart_date } : {}),
    adults: enquiry.adults,
    ...(cabin ? { cabin } : {}),
  };
}

/** One labelled fact in a definition grid; `muted` for a value that isn't set. */
function Fact({ label, children, muted = false, wide = false }: { label: string; children: ReactNode; muted?: boolean; wide?: boolean }) {
  return (
    <div className={wide ? "col-span-full flex min-w-0 flex-col gap-1" : "flex min-w-0 flex-col gap-1"}>
      <dt className="tm-micro">{label}</dt>
      <dd className={muted ? "text-[13px] leading-5 text-faint" : "min-w-0 break-words text-[13px] leading-5 text-ink"}>{children}</dd>
    </div>
  );
}

function TripPanel({ enquiry }: { enquiry: EnquiryOut }) {
  const children = enquiry.children_ages;
  return (
    <Panel title="Trip" description="What the client asked for">
      <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
        <Fact label="From" muted={!enquiry.origin}>
          <span className="font-mono font-semibold">{enquiry.origin ?? "Not set"}</span>
        </Fact>
        <Fact label="To" muted={!enquiry.destination}>
          <span className="font-mono font-semibold">{enquiry.destination ?? "Not set"}</span>
        </Fact>
        <Fact label="Depart" muted={!enquiry.depart_date}>
          {enquiry.depart_date ? formatDate(enquiry.depart_date) : "Not set"}
        </Fact>
        <Fact label="Return" muted={!enquiry.return_date}>
          {enquiry.return_date ? formatDate(enquiry.return_date) : "One way"}
        </Fact>
        <Fact label="Travellers">
          {travellersLabel(enquiry)}
          {children.length > 0 && <span className="text-dim"> (ages {children.join(", ")})</span>}
        </Fact>
        <Fact label="Cabin">{cabinLabel(enquiry.cabin)}</Fact>
        <Fact label="Budget" muted={!enquiry.budget}>
          {enquiry.budget ? (
            <span className="tm-num">{formatWholeMoney(enquiry.budget.amount_minor, enquiry.budget.currency)}</span>
          ) : (
            "No budget given"
          )}
        </Fact>
        <Fact label="Source">{SOURCE_LABEL[enquiry.source] ?? enquiry.source}</Fact>
        <Fact label="Notes" muted={!enquiry.notes} wide>
          {enquiry.notes ?? "No notes"}
        </Fact>
        {enquiry.raw_text && (
          <Fact label="Original message" wide>
            <span className="block whitespace-pre-wrap rounded-md border border-line bg-surface-2 px-3 py-2 text-dim">{enquiry.raw_text}</span>
          </Fact>
        )}
        {enquiry.status === "lost" && (
          <Fact label="Lost reason" wide muted={!enquiry.lost_reason}>
            {enquiry.lost_reason ?? "No reason recorded"}
          </Fact>
        )}
      </dl>
    </Panel>
  );
}

function QuotesPanel({ enquiry, onCreate, creating }: { enquiry: EnquiryOut; onCreate: () => void; creating: boolean }) {
  const navigate = useNavigate();
  const quotes = useQuery(quotesQueryOptions({ enquiry_id: enquiry.id, limit: 50 }));
  const rows = quotes.data?.items ?? [];
  const columns: DataTableColumn<QuoteSummary>[] = [
    { key: "number", header: "Quote", cell: (q) => <span className="font-mono">{q.number}</span>, sortValue: (q) => q.number },
    { key: "status", header: "Status", cell: (q) => <StatusPill status={q.status} /> },
    {
      key: "value",
      header: "From",
      align: "right",
      cell: (q) => (q.min_sell_minor !== null ? formatWholeMoney(q.min_sell_minor, q.currency) : "—"),
      sortValue: (q) => q.min_sell_minor ?? -1,
    },
    {
      key: "versions",
      header: "Versions",
      align: "right",
      cell: (q) => (
        <span className="whitespace-nowrap">
          {q.sent_version ? `v${q.current_version} · sent v${q.sent_version}` : q.current_version > 0 ? `v${q.current_version}` : "—"}
        </span>
      ),
      sortValue: (q) => q.current_version,
    },
    {
      key: "sent",
      header: "Sent",
      cell: (q) => <span className="whitespace-nowrap text-dim">{q.sent_at ? formatDate(q.sent_at) : "Not sent"}</span>,
      sortValue: (q) => q.sent_at ?? "",
    },
  ];
  return (
    <Panel
      title="Quotes"
      description={quotes.data ? `${formatNumber(quotes.data.total)} for this enquiry` : "Built and sent for this enquiry"}
      flush
      actions={
        rows.length > 0 && (
          <Button variant="secondary" size="sm" onClick={onCreate} loading={creating}>
            {!creating && <FilePlus2 size={14} aria-hidden="true" />}
            New quote
          </Button>
        )
      }
    >
      {quotes.isError ? (
        <div className="px-4 pb-4">
          <PanelError error={quotes.error} onRetry={() => void quotes.refetch()} retrying={quotes.isFetching} />
        </div>
      ) : (
        <DataTable
          caption={`Quotes for ${enquiry.number}`}
          columns={columns}
          rows={rows}
          getRowId={(q) => q.id}
          loading={quotes.isPending}
          onRowClick={(q) => void navigate({ to: "/app/quotes/$quoteId", params: { quoteId: q.id } })}
          emptyState={
            <EmptyState
              icon={FileText}
              title="No quotes yet"
              description="Search fares for this trip, then build a quote with up to three options and your markup."
              action={{ label: "Create quote", onClick: onCreate }}
              className="py-6"
            />
          }
        />
      )}
    </Panel>
  );
}

function DetailsPanel({ enquiry, now }: { enquiry: EnquiryOut; now: Date }) {
  return (
    <Panel title="Details">
      <dl className="flex flex-col gap-3.5">
        <Fact label="Client" muted={!enquiry.client}>
          {enquiry.client ? (
            <Link
              to="/app/clients/$clientId"
              params={{ clientId: enquiry.client.id }}
              className="font-medium text-primary underline-offset-2 hover:underline"
            >
              {enquiry.client.name}
            </Link>
          ) : (
            "No client linked"
          )}
        </Fact>
        <Fact label="Assignee" muted={!enquiry.assignee}>
          {enquiry.assignee ? (
            <span className="flex items-center gap-2">
              <Avatar name={enquiry.assignee.full_name} size="sm" />
              {enquiry.assignee.full_name}
            </span>
          ) : (
            "Unassigned"
          )}
        </Fact>
        <Fact label="Created">
          {formatDate(enquiry.created_at)} <span className="text-dim">· {ageDescription(enquiry.created_at, now)}</span>
        </Fact>
        <Fact label="Last updated">{formatRelativeTime(enquiry.updated_at, now)}</Fact>
        {enquiry.closed_at && <Fact label="Closed">{formatDate(enquiry.closed_at)}</Fact>}
      </dl>
    </Panel>
  );
}

const DAY_MS = 86_400_000;
const utcDay = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));

/** "in 18 d", "Today", "3 d ago" for a YYYY-MM-DD departure, counted in calendar days. */
function departsIn(depart: string): string {
  const days = Math.round((utcDay(depart) - utcDay(isoDateFromNow(0))) / DAY_MS);
  if (days === 0) return "Today";
  return days > 0 ? `in ${days} d` : `${-days} d ago`;
}

/** The enquiry's headline figures: departure, quotes, latest quote value and how long it has been open. */
function EnquiryFigures({ enquiry, now }: { enquiry: EnquiryOut; now: Date }) {
  const quotes = useQuery(quotesQueryOptions({ enquiry_id: enquiry.id, limit: 50 }));
  const latest = latestQuotes(quotes.data?.items ?? []).get(enquiry.id);
  const loading = quotes.isPending;
  return (
    <KpiStrip label="Enquiry figures" columns={4} className="mb-4">
      <KpiTile
        label="Departs"
        value={enquiry.depart_date ? departsIn(enquiry.depart_date) : "—"}
        hint={enquiry.depart_date ? formatDate(enquiry.depart_date) : "No date yet"}
      />
      <KpiTile
        label="Quotes"
        value={formatNumber(quotes.data?.total ?? enquiry.quote_count)}
        hint={latest ? `Latest ${latest.number}` : "None yet"}
        loading={loading}
      />
      <KpiTile
        label="Latest quote"
        value={latest && latest.min_sell_minor !== null ? formatWholeMoney(latest.min_sell_minor, latest.currency) : "—"}
        hint={latest ? "Cheapest option" : enquiry.budget ? `Budget ${formatWholeMoney(enquiry.budget.amount_minor, enquiry.budget.currency)}` : "No budget given"}
        loading={loading}
      />
      <KpiTile
        label={enquiry.closed_at ? "Closed" : "Open for"}
        value={enquiry.closed_at ? `${ageLabel(enquiry.closed_at, now)} ago` : ageLabel(enquiry.created_at, now)}
        hint={enquiry.closed_at ? `On ${formatDate(enquiry.closed_at)}` : `Created ${formatDate(enquiry.created_at)}`}
      />
    </KpiStrip>
  );
}

function LoadingEnquiry() {
  return (
    <>
      <PageHeader breadcrumb={[...CRUMBS, { label: "Enquiry" }]} title="Enquiry" description={<Skeleton className="mt-1 h-3.5 w-72" />} />
      <div aria-busy="true" className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(18rem,1fr)]">
        <span className="sr-only">Loading enquiry…</span>
        <div className="flex flex-col gap-4">
          <Panel title="Trip">
            <Skeleton lines={4} />
          </Panel>
          <Panel title="Quotes">
            <Skeleton lines={3} />
          </Panel>
        </div>
        <Panel title="Details">
          <Skeleton lines={5} />
        </Panel>
      </div>
    </>
  );
}

function EnquiryView({ enquiry }: { enquiry: EnquiryOut }) {
  const navigate = useNavigate();
  const now = useClock(60_000);
  const { toast } = useToast();
  const createQuote = useCreateQuote();
  const { move, dialog } = useEnquiryMove();
  const [editing, setEditing] = useState(false);
  const dates = tripDates(enquiry);

  function startQuote() {
    createQuote.mutate(
      { enquiry_id: enquiry.id },
      {
        onSuccess: (quote) => {
          toast({ tone: "ok", title: `Quote ${quote.number} created` });
          void navigate({ to: "/app/quotes/$quoteId", params: { quoteId: quote.id } });
        },
        onError: (error) => toast({ tone: "danger", title: "Couldn't create the quote", description: asApiError(error).message }),
      },
    );
  }

  const summary = [routeLabel(enquiry), dates ?? "Dates not set", travellersLabel(enquiry), cabinLabel(enquiry.cabin)].join(" · ");

  return (
    <>
      <PageHeader
        breadcrumb={[...CRUMBS, { label: enquiry.number }]}
        title={enquiry.number}
        meta={<StatusPill status={enquiry.status} />}
        description={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-mono text-ink">{summary}</span>
            {enquiry.client && (
              <>
                <span aria-hidden="true" className="text-faint">
                  ·
                </span>
                <Link to="/app/clients/$clientId" params={{ clientId: enquiry.client.id }} className="text-primary underline-offset-2 hover:underline">
                  {enquiry.client.name}
                </Link>
              </>
            )}
            {enquiry.assignee && (
              <>
                <span aria-hidden="true" className="text-faint">
                  ·
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Avatar name={enquiry.assignee.full_name} size="sm" className="h-5 w-5 text-[9px]" />
                  {enquiry.assignee.full_name}
                </span>
              </>
            )}
          </span>
        }
        actions={
          <>
            <MoveMenu enquiry={enquiry} onMove={(to) => move(enquiry, to)} variant="button" />
            <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
              <Pencil size={14} aria-hidden="true" />
              Edit
            </Button>
            <Link to="/app/fares" search={fareSearch(enquiry)} className={buttonClasses({ variant: "secondary", size: "sm" })}>
              <Plane size={14} aria-hidden="true" />
              Scan fares
            </Link>
            <Button size="sm" onClick={startQuote} loading={createQuote.isPending}>
              {!createQuote.isPending && <FilePlus2 size={14} aria-hidden="true" />}
              Create quote
            </Button>
          </>
        }
      />
      <EnquiryFigures enquiry={enquiry} now={now} />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(18rem,1fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          <TripPanel enquiry={enquiry} />
          <QuotesPanel enquiry={enquiry} onCreate={startQuote} creating={createQuote.isPending} />
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          <DetailsPanel enquiry={enquiry} now={now} />
          <EnquiryTimeline enquiryId={enquiry.id} />
        </div>
      </div>
      {dialog}
      <EditEnquiryDrawer enquiry={enquiry} open={editing} onClose={() => setEditing(false)} />
    </>
  );
}

/** One enquiry: trip, quotes and history, with every next step (move, edit, search fares, quote). */
export function EnquiryPage() {
  const { enquiryId } = useParams({ from: "/app/enquiries/$enquiryId" });
  const enquiry = useQuery(enquiryQueryOptions(enquiryId));

  if (enquiry.isPending) return <LoadingEnquiry />;
  if (enquiry.isError) {
    const error = asApiError(enquiry.error);
    return (
      <>
        <PageHeader breadcrumb={[...CRUMBS, { label: "Enquiry" }]} title="Enquiry" />
        {error.status === 404 ? (
          <div className="rounded-lg border border-line bg-surface">
            <EmptyState
              icon={SearchX}
              title="Enquiry not found"
              description="It may have been removed, or the link is from another workspace."
              action={{ label: "Back to pipeline", to: "/app/pipeline" }}
            />
          </div>
        ) : (
          <PanelError error={enquiry.error} onRetry={() => void enquiry.refetch()} retrying={enquiry.isFetching} />
        )}
      </>
    );
  }
  return <EnquiryView enquiry={enquiry.data} />;
}

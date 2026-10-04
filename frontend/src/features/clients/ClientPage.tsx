import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { FilePlus2, FileText, Mail, Pencil, Phone, Plane, SearchX, SquareKanban, Trash2 } from "lucide-react";
import { useState, type ReactNode } from "react";
import { asApiError } from "../../api/client";
import { clientActivityQueryOptions, clientQueryOptions, useDeleteClient, type ClientOut } from "../../api/clients";
import { enquiriesQueryOptions, type EnquiryOut } from "../../api/enquiries";
import { quotesQueryOptions, type QuoteSummary } from "../../api/quotes";
import { formatDate, formatNumber, formatRelativeTime } from "../../lib/format";
import { formatMoneyCompact, formatWholeMoney } from "../../lib/money";
import { useClock } from "../../shell/useClock";
import { Avatar } from "../../ui/Avatar";
import { Badge } from "../../ui/Badge";
import { Button, buttonClasses } from "../../ui/Button";
import { KpiStrip, KpiTile } from "../../ui/charts";
import { DataTable, type DataTableColumn } from "../../ui/DataTable";
import { Dialog } from "../../ui/Dialog";
import { EmptyState } from "../../ui/EmptyState";
import { PageHeader } from "../../ui/PageHeader";
import { Panel } from "../../ui/Panel";
import { Skeleton } from "../../ui/Skeleton";
import { StatusPill } from "../../ui/StatusPill";
import { useToast } from "../../ui/toast/useToast";
import { NewEnquiryDialog } from "../command/NewEnquiryDialog";
import { PanelError } from "../command/PanelError";
import { TimelinePanel } from "../enquiries/EnquiryTimeline";
import { routeLabel, travellersLabel, tripDates } from "../pipeline/enquiryFacts";
import { ClientFormDrawer } from "./ClientFormDrawer";
import { airportPlace, kindLabel, mailtoHref, telHref, tripRoute, tripWhen, useAirport } from "./clientFacts";

const CRUMBS = [{ label: "Clients", to: "/app/clients" as const }];
/** Enquiries and quotes listed per client (the API's page limit). */
const LIST_LIMIT = 200;
const OPEN_ENQUIRY = new Set(["new", "quoting", "quoted"]);

/** A link inside a clickable row: it navigates on its own, so the row's click must not fire as well. */
const stop = (event: { stopPropagation: () => void }) => event.stopPropagation();
const RECORD_LINK = "font-mono text-[13px] text-primary underline-offset-2 hover:underline";

/** The client's enquiries, newest first, filtered by the server on the client id. */
function useClientEnquiries(client: ClientOut) {
  const query = useQuery(enquiriesQueryOptions({ client_id: client.id, limit: LIST_LIMIT }));
  return { query, items: query.data?.items ?? [] };
}

function useClientQuotes(client: ClientOut) {
  const query = useQuery(quotesQueryOptions({ client_id: client.id, limit: LIST_LIMIT }));
  return { query, items: query.data?.items ?? [] };
}

function Fact({ label, children, muted = false }: { label: string; children: ReactNode; muted?: boolean }) {
  return (
    <div className="grid grid-cols-[6.5rem_minmax(0,1fr)] items-baseline gap-3">
      <dt className="tm-micro">{label}</dt>
      <dd className={muted ? "text-[13px] leading-5 text-faint" : "min-w-0 break-words text-[13px] leading-5 text-ink"}>{children}</dd>
    </div>
  );
}

function ContactPanel({ client, now }: { client: ClientOut; now: Date }) {
  const airport = useAirport(client.home_airport);
  const place = airportPlace(airport);
  const tel = client.phone ? telHref(client.phone) : null;
  return (
    <Panel title="Contact" description={`${kindLabel(client.kind)} client`}>
      <dl className="flex flex-col gap-3">
        <Fact label="Email" muted={!client.email}>
          {client.email ? (
            <a href={mailtoHref(client.email)} className="inline-flex max-w-full items-center gap-1.5 text-primary underline-offset-2 hover:underline">
              <Mail size={13} aria-hidden="true" className="shrink-0" />
              <span className="min-w-0 break-all">{client.email}</span>
            </a>
          ) : (
            "No email"
          )}
        </Fact>
        <Fact label="Phone" muted={!client.phone}>
          {tel ? (
            <a href={tel} className="inline-flex items-center gap-1.5 text-primary underline-offset-2 hover:underline">
              <Phone size={13} aria-hidden="true" className="shrink-0" />
              <span className="font-mono">{client.phone}</span>
            </a>
          ) : client.phone ? (
            <span className="inline-flex items-center gap-1.5">
              <Phone size={13} aria-hidden="true" className="shrink-0 text-dim" />
              {client.phone}
            </span>
          ) : (
            "No phone number"
          )}
        </Fact>
        <Fact label="Company" muted={!client.company_name}>
          {client.company_name ?? "No company"}
        </Fact>
        <Fact label="Home airport" muted={!client.home_airport}>
          {client.home_airport ? (
            <span className="flex flex-col">
              <span className="font-mono font-semibold">{client.home_airport}</span>
              {place && <span className="text-xs text-dim">{place}</span>}
            </span>
          ) : (
            "Not set"
          )}
        </Fact>
        <Fact label="Tags" muted={client.tags.length === 0}>
          {client.tags.length > 0 ? (
            <span className="flex flex-wrap gap-1">
              {client.tags.map((tag) => (
                <span key={tag} className="inline-flex h-5 items-center rounded-[4px] border border-line bg-surface-2 px-1.5 text-[11px] leading-none text-dim">
                  {tag}
                </span>
              ))}
            </span>
          ) : (
            "No tags"
          )}
        </Fact>
        <Fact label="Notes" muted={!client.notes}>
          <span className="whitespace-pre-wrap">{client.notes ?? "No notes"}</span>
        </Fact>
        <Fact label="Client since">{formatDate(client.created_at)}</Fact>
        <Fact label="Updated">{formatRelativeTime(client.updated_at, now)}</Fact>
      </dl>
    </Panel>
  );
}

function ClientFigures({ client, enquiries, quotes }: { client: ClientOut; enquiries: readonly EnquiryOut[] | null; quotes: readonly QuoteSummary[] | null }) {
  const open = enquiries?.filter((e) => OPEN_ENQUIRY.has(e.status)).length ?? 0;
  const won = enquiries?.filter((e) => e.status === "won").length ?? 0;
  const accepted = quotes?.filter((q) => q.status === "accepted").length ?? 0;
  const waiting = quotes?.filter((q) => q.status === "sent" || q.status === "viewed").length ?? 0;
  return (
    <KpiStrip label="Client figures" columns={5} className="mb-4">
      <KpiTile
        label="Enquiries"
        value={formatNumber(client.enquiry_count)}
        hint={enquiries ? `${open} open · ${won} won` : "Loading…"}
      />
      <KpiTile
        label="Quotes"
        value={formatNumber(client.quote_count)}
        hint={quotes ? `${accepted} accepted · ${waiting} awaiting reply` : "Loading…"}
      />
      <KpiTile
        label="Won value"
        value={formatMoneyCompact({ amount_minor: client.won_value_minor, currency: client.currency })}
        hint={accepted > 0 ? `From ${accepted} accepted quote${accepted === 1 ? "" : "s"}` : "No accepted quotes yet"}
      />
      <KpiTile
        label="Last trip"
        value={client.last_trip ? tripRoute(client.last_trip) : "—"}
        hint={client.last_trip ? tripWhen(client.last_trip) : "No past trips"}
      />
      <KpiTile
        label="Next trip"
        value={client.next_trip ? tripRoute(client.next_trip) : "—"}
        hint={client.next_trip ? tripWhen(client.next_trip) : "Nothing booked ahead"}
      />
    </KpiStrip>
  );
}

function EnquiriesPanel({
  client,
  query,
  rows,
  onCreate,
  now,
}: {
  client: ClientOut;
  query: ReturnType<typeof useClientEnquiries>["query"];
  rows: readonly EnquiryOut[];
  onCreate: () => void;
  now: Date;
}) {
  const navigate = useNavigate();
  const columns: DataTableColumn<EnquiryOut>[] = [
    {
      key: "number",
      header: "Enquiry",
      cell: (e) => (
        <Link to="/app/enquiries/$enquiryId" params={{ enquiryId: e.id }} onClick={stop} className={RECORD_LINK}>
          {e.number}
        </Link>
      ),
      sortValue: (e) => e.number,
    },
    {
      key: "route",
      header: "Route",
      cell: (e) => <span className="whitespace-nowrap font-mono font-medium">{routeLabel(e)}</span>,
      sortValue: (e) => routeLabel(e),
    },
    {
      key: "dates",
      header: "Dates",
      cell: (e) => <span className="whitespace-nowrap text-dim">{tripDates(e) ?? "Not set"}</span>,
      sortValue: (e) => e.depart_date ?? "",
    },
    { key: "travellers", header: "Travellers", cell: (e) => <span className="whitespace-nowrap text-dim">{travellersLabel(e)}</span> },
    { key: "status", header: "Status", cell: (e) => <StatusPill status={e.status} /> },
    { key: "quotes", header: "Quotes", align: "right", cell: (e) => formatNumber(e.quote_count), sortValue: (e) => e.quote_count },
    {
      key: "created",
      header: "Created",
      cell: (e) => (
        <time dateTime={e.created_at} title={formatDate(e.created_at)} className="whitespace-nowrap text-dim">
          {formatRelativeTime(e.created_at, now)}
        </time>
      ),
      sortValue: (e) => e.created_at,
    },
  ];
  return (
    <Panel
      title="Enquiries"
      description={query.data ? `${formatNumber(query.data.total)} for ${client.name} · newest first` : "Trip requests from this client"}
      flush
    >
      {query.isError ? (
        <div className="px-4 pb-4">
          <PanelError error={query.error} onRetry={() => void query.refetch()} retrying={query.isFetching} />
        </div>
      ) : (
        <>
          {!query.isPending && rows.length > 0 && (
            <ul aria-label={`Enquiries for ${client.name}`} className="flex flex-col border-t border-line sm:hidden">
              {rows.map((e) => (
                <li key={e.id} className="border-b border-line last:border-b-0">
                  <Link
                    to="/app/enquiries/$enquiryId"
                    params={{ enquiryId: e.id }}
                    className="flex flex-col gap-1 px-4 py-2.5 transition-colors duration-150 ease-tm hover:bg-hover"
                  >
                    <span className="flex items-center gap-2">
                      <span className="font-mono text-[13px] text-ink">{e.number}</span>
                      <span className="font-mono text-[13px] font-medium text-ink">{routeLabel(e)}</span>
                      <StatusPill status={e.status} className="ml-auto" />
                    </span>
                    <span className="text-xs text-dim">
                      {[tripDates(e) ?? "Dates not set", travellersLabel(e), `${e.quote_count} quote${e.quote_count === 1 ? "" : "s"}`].join(" · ")}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <DataTable
            className={rows.length > 0 ? "max-sm:hidden" : undefined}
            caption={`Enquiries for ${client.name}`}
            columns={columns}
            rows={rows}
            getRowId={(e) => e.id}
            loading={query.isPending}
            onRowClick={(e) => void navigate({ to: "/app/enquiries/$enquiryId", params: { enquiryId: e.id } })}
            emptyState={
              <EmptyState
                icon={SquareKanban}
                title="No enquiries yet"
                description={`Capture ${client.name}'s next trip request and it appears here and in the pipeline.`}
                action={{ label: "New enquiry", onClick: onCreate }}
                className="py-6"
              />
            }
          />
          {query.data && query.data.total > query.data.items.length && (
            <p className="border-t border-line px-4 py-2 text-xs text-dim">
              Showing the {formatNumber(query.data.items.length)} newest of {formatNumber(query.data.total)} enquiries.
            </p>
          )}
        </>
      )}
    </Panel>
  );
}

function versionsLabel(q: QuoteSummary): string {
  if (q.current_version === 0) return "—";
  return q.sent_version ? `v${q.current_version} · sent v${q.sent_version}` : `v${q.current_version}`;
}

function QuotesPanel({
  client,
  query,
  rows,
  now,
}: {
  client: ClientOut;
  query: ReturnType<typeof useClientQuotes>["query"];
  rows: readonly QuoteSummary[];
  now: Date;
}) {
  const navigate = useNavigate();
  const columns: DataTableColumn<QuoteSummary>[] = [
    {
      key: "number",
      header: "Quote",
      cell: (q) => (
        <Link to="/app/quotes/$quoteId" params={{ quoteId: q.id }} onClick={stop} className={RECORD_LINK}>
          {q.number}
        </Link>
      ),
      sortValue: (q) => q.number,
    },
    {
      key: "enquiry",
      header: "Trip",
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
    { key: "status", header: "Status", cell: (q) => <StatusPill status={q.status} /> },
    {
      key: "value",
      header: "From",
      align: "right",
      cell: (q) => (q.min_sell_minor !== null ? formatWholeMoney(q.min_sell_minor, q.currency) : <span className="text-faint">—</span>),
      sortValue: (q) => q.min_sell_minor ?? -1,
    },
    { key: "versions", header: "Versions", align: "right", cell: (q) => <span className="whitespace-nowrap">{versionsLabel(q)}</span> },
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
  ];
  return (
    <Panel
      title="Quotes"
      description={query.data ? `${formatNumber(query.data.total)} for ${client.name} · values are each quote's cheapest option` : "Built and sent for this client"}
      flush
    >
      {query.isError ? (
        <div className="px-4 pb-4">
          <PanelError error={query.error} onRetry={() => void query.refetch()} retrying={query.isFetching} />
        </div>
      ) : (
        <>
          {!query.isPending && rows.length > 0 && (
            <ul aria-label={`Quotes for ${client.name}`} className="flex flex-col border-t border-line sm:hidden">
              {rows.map((q) => (
                <li key={q.id} className="border-b border-line last:border-b-0">
                  <Link
                    to="/app/quotes/$quoteId"
                    params={{ quoteId: q.id }}
                    className="flex flex-col gap-1 px-4 py-2.5 transition-colors duration-150 ease-tm hover:bg-hover"
                  >
                    <span className="flex items-center gap-2">
                      <span className="font-mono text-[13px] text-ink">{q.number}</span>
                      <StatusPill status={q.status} />
                      <span className="ml-auto font-mono text-[13px] tabular-nums text-ink">
                        {q.min_sell_minor !== null ? formatWholeMoney(q.min_sell_minor, q.currency) : "—"}
                      </span>
                    </span>
                    <span className="text-xs text-dim">
                      <span className="font-mono">{routeLabel(q.enquiry)}</span> · {q.enquiry.number} · {versionsLabel(q)} ·{" "}
                      {q.sent_at ? `Sent ${formatRelativeTime(q.sent_at, now)}` : "Not sent"}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <DataTable
            className={rows.length > 0 ? "max-sm:hidden" : undefined}
            caption={`Quotes for ${client.name}`}
            columns={columns}
            rows={rows}
            getRowId={(q) => q.id}
            loading={query.isPending}
            onRowClick={(q) => void navigate({ to: "/app/quotes/$quoteId", params: { quoteId: q.id } })}
            emptyState={
              <EmptyState
                icon={FileText}
                title="No quotes yet"
                description="Quotes start from one of the client's enquiries: open it and choose Create quote."
                className="py-6"
              />
            }
          />
        </>
      )}
    </Panel>
  );
}

function DeleteClientDialog({ client, onClose }: { client: ClientOut; onClose: () => void }) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const remove = useDeleteClient();
  const error = remove.error ? asApiError(remove.error) : null;
  const blocked = error?.status === 409;

  function confirm() {
    remove.mutate(client.id, {
      onSuccess: () => {
        toast({ tone: "ok", title: `${client.name} deleted` });
        onClose();
        void navigate({ to: "/app/clients" });
      },
    });
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Delete ${client.name}?`}
      description="This can't be undone."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {blocked ? "Close" : "Cancel"}
          </Button>
          <Button variant="danger" onClick={confirm} loading={remove.isPending} disabled={blocked}>
            <Trash2 size={14} aria-hidden="true" />
            Delete client
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 text-[13px] leading-5 text-dim">
        <p>
          The client record, contact details, tags and notes are removed. Enquiries stay in the pipeline without a client.
          {client.quote_count > 0 && " A client with quotes can't be deleted, so their quote history stays complete."}
        </p>
        {error && (
          <p role="alert" className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-ink">
            {error.message}
          </p>
        )}
      </div>
    </Dialog>
  );
}

function ClientHeaderMeta({ client }: { client: ClientOut }) {
  return (
    <>
      <Badge tone={client.kind === "company" ? "info" : "neutral"}>{kindLabel(client.kind)}</Badge>
      {client.tags.map((tag) => (
        <Badge key={tag} tone="primary">
          {tag}
        </Badge>
      ))}
    </>
  );
}

function ClientView({ client }: { client: ClientOut }) {
  const now = useClock(60_000);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [enquiring, setEnquiring] = useState(false);
  const enquiries = useClientEnquiries(client);
  const quotes = useClientQuotes(client);
  const timeline = useQuery(clientActivityQueryOptions(client.id));
  const contact = [client.company_name, client.email, client.phone].filter(Boolean).join(" · ");

  return (
    <>
      <PageHeader
        breadcrumb={[...CRUMBS, { label: client.name }]}
        title={client.name}
        meta={<ClientHeaderMeta client={client} />}
        description={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Avatar name={client.name} size="sm" className="h-5 w-5 text-[9px]" />
            <span className="text-ink">{contact || "No contact details yet"}</span>
            <span aria-hidden="true" className="text-faint">
              ·
            </span>
            <span>Client since {formatDate(client.created_at)}</span>
          </span>
        }
        actions={
          <>
            <Button variant="ghost" size="sm" onClick={() => setDeleting(true)}>
              <Trash2 size={14} aria-hidden="true" />
              Delete
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
              <Pencil size={14} aria-hidden="true" />
              Edit
            </Button>
            {client.home_airport && (
              <Link
                to="/app/fares"
                search={{ origin: client.home_airport }}
                className={buttonClasses({ variant: "secondary", size: "sm" })}
              >
                <Plane size={14} aria-hidden="true" />
                Scan fares
              </Link>
            )}
            <Button size="sm" onClick={() => setEnquiring(true)}>
              <FilePlus2 size={14} aria-hidden="true" />
              New enquiry
            </Button>
          </>
        }
      />
      <ClientFigures
        client={client}
        enquiries={enquiries.query.data ? enquiries.items : null}
        quotes={quotes.query.data ? quotes.items : null}
      />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(19rem,1fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          <EnquiriesPanel client={client} query={enquiries.query} rows={enquiries.items} onCreate={() => setEnquiring(true)} now={now} />
          <QuotesPanel client={client} query={quotes.query} rows={quotes.items} now={now} />
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          <ContactPanel client={client} now={now} />
          <TimelinePanel
            timeline={timeline}
            intro="Changes, enquiries, quotes and client views"
            emptyDescription="Edits, enquiries and quotes for this client will be listed here as they happen."
          />
        </div>
      </div>
      <ClientFormDrawer open={editing} onClose={() => setEditing(false)} client={client} />
      {deleting && <DeleteClientDialog client={client} onClose={() => setDeleting(false)} />}
      <NewEnquiryDialog
        open={enquiring}
        onClose={() => setEnquiring(false)}
        client={{ id: client.id, name: client.name, email: client.email, company_name: client.company_name }}
      />
    </>
  );
}

function LoadingClient() {
  return (
    <>
      <PageHeader breadcrumb={[...CRUMBS, { label: "Client" }]} title="Client" description={<Skeleton className="mt-1 h-3.5 w-72" />} />
      <div aria-busy="true" className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(19rem,1fr)]">
        <span className="sr-only">Loading client…</span>
        <div className="flex flex-col gap-4">
          <Panel title="Enquiries">
            <Skeleton lines={3} />
          </Panel>
          <Panel title="Quotes">
            <Skeleton lines={3} />
          </Panel>
        </div>
        <Panel title="Contact">
          <Skeleton lines={6} />
        </Panel>
      </div>
    </>
  );
}

/** One client as a CRM record: contact card, figures, enquiries, quotes and timeline, with edit and delete. */
export function ClientPage() {
  const { clientId } = useParams({ from: "/app/clients/$clientId" });
  const client = useQuery(clientQueryOptions(clientId));

  if (client.isPending) return <LoadingClient />;
  if (client.isError) {
    const error = asApiError(client.error);
    return (
      <>
        <PageHeader breadcrumb={[...CRUMBS, { label: "Client" }]} title="Client" />
        {error.status === 404 ? (
          <div className="rounded-lg border border-line bg-surface">
            <EmptyState
              icon={SearchX}
              title="Client not found"
              description="They may have been deleted, or the link is from another workspace."
              action={{ label: "Back to clients", to: "/app/clients" }}
            />
          </div>
        ) : (
          <PanelError error={client.error} onRetry={() => void client.refetch()} retrying={client.isFetching} />
        )}
      </>
    );
  }
  return <ClientView client={client.data} />;
}

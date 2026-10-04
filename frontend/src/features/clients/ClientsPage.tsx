import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { CalendarClock, ChevronDown, History, Search, SearchX, Tags, UserPlus, UserRound, X } from "lucide-react";
import { useMemo, useState } from "react";
import { clientsQueryOptions, type ClientOut } from "../../api/clients";
import { useCurrentUser } from "../../auth/useCurrentUser";
import { formatDate, formatDayMonth, formatNumber } from "../../lib/format";
import { useDebouncedValue } from "../../lib/useDebouncedValue";
import { Avatar } from "../../ui/Avatar";
import { Badge } from "../../ui/Badge";
import { Button } from "../../ui/Button";
import { KpiStrip, KpiTile } from "../../ui/charts";
import { cn } from "../../ui/cn";
import { DataTable, type DataTableColumn } from "../../ui/DataTable";
import { EmptyState } from "../../ui/EmptyState";
import { PageHeader } from "../../ui/PageHeader";
import { Panel } from "../../ui/Panel";
import { PanelError } from "../command/PanelError";
import { formatWholeMoney } from "../pipeline/enquiryFacts";
import { ClientFormDrawer } from "./ClientFormDrawer";
import { kindLabel, tagCounts, tripRoute, tripWhen } from "./clientFacts";

/** The list shows up to this many clients (the API's page limit), most recently updated first. */
const LIST_LIMIT = 200;
const SHOWN_TAGS = 3;

const TOOLBAR_CONTROL = cn(
  "h-8 w-full rounded-md border border-line-strong bg-surface-2 text-[13px] text-ink placeholder:text-faint",
  "transition-colors duration-150 ease-tm hover:border-faint focus:border-primary",
);

function TagList({ tags, max = SHOWN_TAGS }: { tags: readonly string[]; max?: number }) {
  if (tags.length === 0) return <span className="text-faint">—</span>;
  const shown = tags.slice(0, max);
  return (
    <span className="flex items-center gap-1 whitespace-nowrap">
      {shown.map((tag) => (
        <span key={tag} className="inline-flex h-5 items-center rounded-[4px] border border-line bg-surface-2 px-1.5 text-[11px] leading-none text-dim">
          {tag}
        </span>
      ))}
      {tags.length > max && <span className="text-[11px] text-faint">+{tags.length - max}</span>}
    </span>
  );
}

function NextTrip({ client }: { client: ClientOut }) {
  const trip = client.next_trip;
  if (!trip) return <span className="whitespace-nowrap text-faint">None booked</span>;
  return (
    <span className="flex flex-col whitespace-nowrap leading-4">
      <span className="font-mono text-[13px] font-medium text-ink">{tripRoute(trip)}</span>
      <span className="text-[11px] text-dim">
        {tripWhen(trip)}
      </span>
    </span>
  );
}

type Figures = {
  total: number;
  companies: number;
  upcoming: ClientOut[];
  repeat: number;
  quotes: number;
  quoted: number;
  won: number;
  top: ClientOut | null;
};

function figuresOf(items: readonly ClientOut[], total: number): Figures {
  const upcoming = items
    .filter((c) => c.next_trip)
    .sort((a, b) => (a.next_trip?.depart_date ?? "").localeCompare(b.next_trip?.depart_date ?? ""));
  let top: ClientOut | null = null;
  for (const client of items) if (client.won_value_minor > (top?.won_value_minor ?? 0)) top = client;
  return {
    total,
    companies: items.filter((c) => c.kind === "company").length,
    upcoming,
    repeat: items.filter((c) => c.enquiry_count >= 2).length,
    quotes: items.reduce((sum, c) => sum + c.quote_count, 0),
    quoted: items.filter((c) => c.quote_count > 0).length,
    won: items.reduce((sum, c) => sum + c.won_value_minor, 0),
    top,
  };
}

function ClientFigures({ figures, currency, loading }: { figures: Figures; currency: string; loading: boolean }) {
  const soonest = figures.upcoming[0];
  const individuals = figures.total - figures.companies;
  return (
    <KpiStrip label="Client figures" columns={5} busy={loading} className="mb-4">
      <KpiTile
        label="Clients"
        value={formatNumber(figures.total)}
        hint={`${formatNumber(individuals)} ${individuals === 1 ? "person" : "people"} · ${formatNumber(figures.companies)} compan${figures.companies === 1 ? "y" : "ies"}`}
        loading={loading}
      />
      <KpiTile
        label="Trips ahead"
        value={formatNumber(figures.upcoming.length)}
        hint={soonest?.next_trip ? `Soonest ${formatDayMonth(soonest.next_trip.depart_date)} · ${soonest.name}` : "No upcoming departures"}
        loading={loading}
      />
      <KpiTile
        label="Repeat clients"
        value={formatNumber(figures.repeat)}
        hint={figures.total > 0 ? `${Math.round((figures.repeat / figures.total) * 100)}% with 2+ enquiries` : "None yet"}
        loading={loading}
      />
      <KpiTile
        label="Quotes"
        value={formatNumber(figures.quotes)}
        hint={`For ${formatNumber(figures.quoted)} client${figures.quoted === 1 ? "" : "s"}`}
        loading={loading}
      />
      <KpiTile
        label="Won value"
        value={formatWholeMoney(figures.won, currency)}
        hint={figures.top ? `Top: ${figures.top.name}` : "No accepted quotes yet"}
        loading={loading}
      />
    </KpiStrip>
  );
}

const RECORD_PARTS = [
  {
    icon: UserRound,
    title: "Contact and preferences",
    text: "Email, phone, company, home airport and notes such as seat and meal preferences.",
  },
  {
    icon: Tags,
    title: "Tags you filter by",
    text: "Mark clients vip, corporate or family, then filter the list by any tag.",
  },
  {
    icon: History,
    title: "Full history",
    text: "Every enquiry and quote for the client, won value, last and next trips, and a timeline.",
  },
];

function RecordParts() {
  return (
    <Panel title="What a client record holds" description="Add a client once; every enquiry and quote for them builds their history">
      <ul className="grid gap-4 sm:grid-cols-3">
        {RECORD_PARTS.map(({ icon: Icon, title, text }) => (
          <li key={title} className="flex gap-3">
            <span aria-hidden="true" className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-line bg-surface-2 text-dim">
              <Icon size={15} strokeWidth={1.75} />
            </span>
            <div className="min-w-0">
              <p className="text-[13px] font-medium leading-5 text-ink">{title}</p>
              <p className="mt-0.5 text-xs leading-4 text-dim">{text}</p>
            </div>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

/** Phones: each client as a three-line row instead of the wide table. */
function ClientRows({ rows }: { rows: readonly ClientOut[] }) {
  return (
    <ul aria-label="Clients" className="flex flex-col sm:hidden">
      {rows.map((c) => (
        <li key={c.id} className="border-b border-line last:border-b-0">
          <Link
            to="/app/clients/$clientId"
            params={{ clientId: c.id }}
            className="flex gap-3 px-3 py-2.5 transition-colors duration-150 ease-tm hover:bg-hover"
          >
            <Avatar name={c.name} size="md" className="mt-0.5 shrink-0" />
            <span className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="flex items-center gap-2">
                <span className="truncate text-[13px] font-medium text-ink">{c.name}</span>
                {c.kind === "company" && <Badge>Company</Badge>}
                <span className="ml-auto shrink-0 font-mono text-[13px] tabular-nums text-ink">
                  {c.won_value_minor > 0 ? formatWholeMoney(c.won_value_minor, c.currency) : <span className="text-faint">—</span>}
                </span>
              </span>
              <span className="truncate text-xs text-dim">
                {[c.company_name, c.email].filter(Boolean).join(" · ") || "No contact details"}
              </span>
              <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-dim">
                <span>
                  {c.enquiry_count} enquir{c.enquiry_count === 1 ? "y" : "ies"} · {c.quote_count} quote{c.quote_count === 1 ? "" : "s"}
                </span>
                {c.next_trip && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono">
                      {tripRoute(c.next_trip)} {formatDate(c.next_trip.depart_date)}
                    </span>
                  </>
                )}
                {c.tags.length > 0 && <TagList tags={c.tags} max={2} />}
              </span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** The agency's clients: figures, search, a tag filter and the list. */
export function ClientsPage() {
  const me = useCurrentUser();
  const navigate = useNavigate();
  const [term, setTerm] = useState("");
  const [tag, setTag] = useState("");
  const [creating, setCreating] = useState(false);
  const needle = useDebouncedValue(term.trim(), 250);

  const all = useQuery(clientsQueryOptions({ limit: LIST_LIMIT }));
  const filtering = needle !== "" || tag !== "";
  const filtered = useQuery({
    ...clientsQueryOptions({ q: needle || undefined, tag: tag || undefined, limit: LIST_LIMIT }),
    enabled: filtering,
  });
  const source = filtering ? filtered : all;

  const allItems = useMemo(() => all.data?.items ?? [], [all.data]);
  const currency = allItems[0]?.currency ?? me?.agency.currency ?? "INR";
  const figures = useMemo(() => figuresOf(allItems, all.data?.total ?? 0), [allItems, all.data]);
  const tags = useMemo(() => tagCounts(allItems), [allItems]);
  const rows = source.data?.items ?? [];
  const total = all.data?.total ?? 0;
  const nothingYet = !all.isPending && !all.isError && total === 0;

  const columns: DataTableColumn<ClientOut>[] = [
    {
      key: "name",
      header: "Name",
      cell: (c) => (
        <span className="flex items-center gap-2.5 whitespace-nowrap">
          <Avatar name={c.name} size="sm" />
          <span className="flex flex-col leading-4">
            <span className="font-medium text-ink">{c.name}</span>
            <span className="text-[11px] text-dim">
              {kindLabel(c.kind)}
              {c.home_airport ? ` · ${c.home_airport}` : ""}
            </span>
          </span>
        </span>
      ),
      sortValue: (c) => c.name,
    },
    {
      key: "company",
      header: "Company",
      // A company's own name is already in the Name column.
      cell: (c) =>
        c.company_name && c.company_name !== c.name ? (
          <span title={c.company_name} className="block max-w-48 truncate">
            {c.company_name}
          </span>
        ) : (
          <span className="text-faint">—</span>
        ),
      sortValue: (c) => c.company_name ?? "",
    },
    {
      key: "email",
      header: "Email",
      cell: (c) =>
        c.email ? (
          <span title={c.email} className="block max-w-56 truncate text-dim">
            {c.email}
          </span>
        ) : (
          <span className="text-faint">—</span>
        ),
      sortValue: (c) => c.email ?? "",
    },
    { key: "tags", header: "Tags", cell: (c) => <TagList tags={c.tags} /> },
    {
      key: "enquiries",
      header: "Enquiries",
      align: "right",
      cell: (c) => formatNumber(c.enquiry_count),
      sortValue: (c) => c.enquiry_count,
    },
    {
      key: "quotes",
      header: "Quotes",
      align: "right",
      cell: (c) => formatNumber(c.quote_count),
      sortValue: (c) => c.quote_count,
    },
    {
      key: "won",
      header: "Won value",
      align: "right",
      cell: (c) => (c.won_value_minor > 0 ? formatWholeMoney(c.won_value_minor, c.currency) : <span className="text-faint">—</span>),
      sortValue: (c) => c.won_value_minor,
    },
    {
      key: "next",
      header: "Next trip",
      cell: (c) => <NextTrip client={c} />,
      sortValue: (c) => c.next_trip?.depart_date ?? "9999",
    },
  ];

  const clearFilters = () => {
    setTerm("");
    setTag("");
  };
  const filterLabel = [needle && `“${needle}”`, tag && `tag ${tag}`].filter(Boolean).join(" with ");
  const emptyFiltered = (
    <EmptyState
      icon={SearchX}
      title={`No clients match ${filterLabel}`}
      description="Search by name, email or company, or pick another tag."
      action={{ label: needle ? "Clear search" : "Clear filter", onClick: clearFilters }}
    />
  );

  return (
    <>
      <PageHeader
        breadcrumb={[{ label: "Workspace", to: "/app" }, { label: "Clients" }]}
        title="Clients"
        description="The travellers and companies you quote for, with their trips, quotes and won value. Select a client to open their record."
        actions={
          <Button size="sm" onClick={() => setCreating(true)}>
            <UserPlus size={14} aria-hidden="true" />
            New client
          </Button>
        }
      />

      <ClientFigures figures={figures} currency={currency} loading={all.isPending} />

      {all.isError ? (
        <PanelError error={all.error} onRetry={() => void all.refetch()} retrying={all.isFetching} />
      ) : nothingYet ? (
        <div className="flex flex-col gap-4">
          <div className="rounded-lg border border-line bg-surface">
            <EmptyState
              icon={UserRound}
              title="No clients yet"
              description="Add the travellers and companies you quote for. Enquiries and quotes for them build their history here."
              action={{ label: "New client", onClick: () => setCreating(true) }}
            />
          </div>
          <RecordParts />
        </div>
      ) : (
        <section aria-label="Client list" className="rounded-lg border border-line bg-surface">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line px-3 py-2">
            <div className="relative w-full sm:w-72">
              <Search size={14} aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
              <input
                type="search"
                aria-label="Search clients"
                placeholder="Name, email or company"
                value={term}
                onChange={(event) => setTerm(event.target.value)}
                className={cn(TOOLBAR_CONTROL, "pl-8 pr-2.5")}
              />
            </div>
            <div className="relative min-w-0 flex-1 sm:w-44 sm:flex-none">
              <Tags size={14} aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
              <select
                aria-label="Filter by tag"
                value={tag}
                onChange={(event) => setTag(event.target.value)}
                className={cn(TOOLBAR_CONTROL, "cursor-pointer appearance-none pl-8 pr-7")}
              >
                <option value="">All tags</option>
                {tags.map(({ tag: value, count }) => (
                  <option key={value} value={value}>
                    {value} ({count})
                  </option>
                ))}
              </select>
              <ChevronDown size={14} aria-hidden="true" className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-dim" />
            </div>
            {(term || tag) && (
              <Button variant="ghost" size="sm" onClick={clearFilters}>
                <X size={14} aria-hidden="true" />
                Clear
              </Button>
            )}
            <p className="ml-auto shrink-0 font-mono text-xs tabular-nums text-dim" aria-live="polite">
              {source.isPending ? "Loading…" : `${formatNumber(rows.length)} of ${formatNumber(total)} client${total === 1 ? "" : "s"}`}
            </p>
          </div>
          {source.isError ? (
            <div className="p-3">
              <PanelError error={source.error} onRetry={() => void source.refetch()} retrying={source.isFetching} />
            </div>
          ) : (
            <>
              {!source.isPending && rows.length > 0 && <ClientRows rows={rows} />}
              <DataTable
                className={rows.length > 0 ? "max-sm:hidden" : undefined}
                caption="Clients"
                columns={columns}
                rows={rows}
                getRowId={(c) => c.id}
                loading={source.isPending}
                onRowClick={(c) => void navigate({ to: "/app/clients/$clientId", params: { clientId: c.id } })}
                emptyState={emptyFiltered}
              />
            </>
          )}
          {total > allItems.length && (
            <p className="border-t border-line px-3 py-2 text-xs text-dim">
              Showing the {formatNumber(allItems.length)} most recently updated of {formatNumber(total)} clients. Search to find
              others.
            </p>
          )}
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-3 py-2 text-xs text-dim">
            <span>Won value is the sum of each client's accepted quotes, in whole {currency}.</span>
            {figures.upcoming.length > 0 && (
              <span className="inline-flex items-center gap-1.5">
                <CalendarClock size={13} aria-hidden="true" />
                {formatNumber(figures.upcoming.length)} client{figures.upcoming.length === 1 ? "" : "s"} travelling soon
              </span>
            )}
          </div>
        </section>
      )}
      <ClientFormDrawer
        open={creating}
        onClose={() => setCreating(false)}
        tagSuggestions={tags.map((t) => t.tag)}
        onSaved={(client) => void navigate({ to: "/app/clients/$clientId", params: { clientId: client.id } })}
      />
    </>
  );
}

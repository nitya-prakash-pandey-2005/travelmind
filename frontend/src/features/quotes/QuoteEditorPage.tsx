import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { CheckCheck, ChevronDown, CircleX, ClipboardList, Hourglass, SearchX, Send } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { asApiError } from "../../api/client";
import { enquiryQueryOptions, type EnquiryOut } from "../../api/enquiries";
import type { FlightOffer } from "../../api/offers";
import { teamQueryOptions } from "../../api/queries";
import {
  MAX_QUOTE_OPTIONS,
  quoteActivityQueryOptions,
  quoteQueryOptions,
  type QuoteDecisionStatus,
  type QuoteDetail,
} from "../../api/quotes";
import { useCurrentUser } from "../../auth/useCurrentUser";
import { formatDate, formatRelativeTime } from "../../lib/format";
import { formatMoneyCompact, formatWholeMoney } from "../../lib/money";
import { useClock } from "../../shell/useClock";
import { Badge } from "../../ui/Badge";
import { Button } from "../../ui/Button";
import { KpiStrip, KpiTile } from "../../ui/charts";
import { EmptyState } from "../../ui/EmptyState";
import { Menu } from "../../ui/Menu";
import { PageHeader } from "../../ui/PageHeader";
import { Panel } from "../../ui/Panel";
import { Skeleton } from "../../ui/Skeleton";
import { StatusPill } from "../../ui/StatusPill";
import { PanelError } from "../command/PanelError";
import { TimelinePanel } from "../enquiries/EnquiryTimeline";
import { cabinLabel, routeLabel, travellersLabel, tripDates } from "../pipeline/enquiryFacts";
import { describeMarkup } from "./markup";
import { OfferPicker } from "./OfferPicker";
import { QuoteBuilder, type QuotePick } from "./QuoteBuilder";
import { QuoteOutcomeDialog } from "./QuoteOutcomeDialog";
import { SendQuoteDialog } from "./SendQuoteDialog";
import { VersionHistory } from "./VersionHistory";
import { VersionPreview } from "./VersionPreview";

const CRUMBS = [{ label: "Quotes", to: "/app/quotes" as const }];
const DAY_MS = 86_400_000;
const CLOSED_QUOTE = new Set(["accepted", "declined"]);
const SENT = new Set(["sent", "viewed"]);
/** A column of the editor's 12-column grid; at 1180px and below (where the kit grid goes single column) it dissolves. */
const COLUMN = "flex min-w-0 flex-col gap-4 max-[1180.98px]:contents";
/** A card placed straight on the grid once its column dissolves: full width, ordered by the caller. */
const STACKED = "max-[1180.98px]:col-span-full";

/** Why the quote can't take a new version or be sent; null when it can. */
function lockedReason(quote: QuoteDetail, enquiry: EnquiryOut | undefined): string | null {
  if (CLOSED_QUOTE.has(quote.status)) return `This quote was ${quote.status}, so it can't be changed.`;
  if (enquiry && (enquiry.status === "won" || enquiry.status === "lost")) {
    return `${enquiry.number} is ${enquiry.status}. Reopen it in the pipeline before changing this quote.`;
  }
  return null;
}

function statusHint(quote: QuoteDetail, now: Date): string {
  switch (quote.status) {
    case "draft":
      return quote.current_version > 0 ? "Ready to send" : "Add a version, then send";
    case "sent":
      return quote.sent_at ? `Sent ${formatRelativeTime(quote.sent_at, now)} · not opened yet` : "Not opened yet";
    case "viewed":
      return quote.first_viewed_at ? `Opened ${formatRelativeTime(quote.first_viewed_at, now)}` : "Opened by the client";
    case "accepted":
      return quote.accepted_option !== null ? `Option ${quote.accepted_option + 1} chosen` : "Recorded by your team";
    case "declined":
      return quote.decided_at ? `On ${formatDate(quote.decided_at)}` : "By the client";
    case "expired":
      return "Re-send to reopen the link";
  }
}

function linkFigure(quote: QuoteDetail, now: Date): { value: string; hint: string } {
  if (!quote.share_expires_at) return { value: "—", hint: "Created when you send" };
  const left = Math.ceil((new Date(quote.share_expires_at).getTime() - now.getTime()) / DAY_MS);
  if (quote.status === "expired" || left <= 0) return { value: "Expired", hint: `On ${formatDate(quote.share_expires_at)}` };
  if (CLOSED_QUOTE.has(quote.status)) return { value: "Closed", hint: `Decided ${quote.decided_at ? formatDate(quote.decided_at) : ""}`.trim() };
  return { value: `${left} d left`, hint: `Valid until ${formatDate(quote.share_expires_at)}` };
}

function QuoteFigures({ quote, now }: { quote: QuoteDetail; now: Date }) {
  const latest = quote.versions[0];
  const link = linkFigure(quote, now);
  const status = quote.status.charAt(0).toUpperCase() + quote.status.slice(1);
  return (
    <KpiStrip label="Quote figures" columns={5} className="mb-4">
      <KpiTile label="Status" value={status} hint={statusHint(quote, now)} />
      <KpiTile
        label="Versions"
        value={String(quote.current_version)}
        hint={quote.sent_version ? `Client sees v${quote.sent_version}` : "None sent yet"}
      />
      <KpiTile
        label="Cheapest option"
        value={latest ? formatMoneyCompact({ amount_minor: latest.totals.min_sell_minor, currency: quote.currency }) : "—"}
        hint={
          latest
            ? `${latest.totals.options > 1 ? `Up to ${formatMoneyCompact({ amount_minor: latest.totals.max_sell_minor, currency: quote.currency })} · ` : ""}v${latest.version} · ${latest.totals.options} option${latest.totals.options === 1 ? "" : "s"}`
            : "No version yet"
        }
      />
      <KpiTile
        label="Markup"
        value={describeMarkup(quote.markup_kind, quote.markup_value, quote.currency)}
        hint={quote.markup_kind === "percent" ? "Of each supplier fare" : "Added to each option"}
      />
      <KpiTile label="Client link" value={link.value} hint={link.hint} />
    </KpiStrip>
  );
}

function Fact({ label, children, muted = false }: { label: string; children: ReactNode; muted?: boolean }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="tm-micro">{label}</dt>
      <dd className={muted ? "text-[13px] leading-5 text-faint" : "min-w-0 break-words text-[13px] leading-5 text-ink"}>{children}</dd>
    </div>
  );
}

/** The trip this quote answers, from its enquiry. */
function TripPanel({ quote, enquiry, loading, className }: { quote: QuoteDetail; enquiry: EnquiryOut | undefined; loading: boolean; className?: string }) {
  return (
    <Panel
      title="Trip"
      description={`From ${quote.enquiry.number}`}
      className={className}
      footer={
        <Link to="/app/enquiries/$enquiryId" params={{ enquiryId: quote.enquiry.id }} className="text-primary underline-offset-2 hover:underline">
          Open {quote.enquiry.number}
        </Link>
      }
    >
      {loading ? (
        <Skeleton lines={4} />
      ) : (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
          <Fact label="Route">
            <span className="font-mono font-medium">{routeLabel(enquiry ?? quote.enquiry)}</span>
          </Fact>
          <Fact label="Dates" muted={!enquiry?.depart_date && !quote.enquiry.depart_date}>
            {enquiry ? (tripDates(enquiry) ?? "Not set") : quote.enquiry.depart_date ? formatDate(quote.enquiry.depart_date) : "Not set"}
          </Fact>
          {enquiry && (
            <>
              <Fact label="Travellers">{travellersLabel(enquiry)}</Fact>
              <Fact label="Cabin">{cabinLabel(enquiry.cabin)}</Fact>
              <Fact label="Budget" muted={!enquiry.budget}>
                {enquiry.budget ? <span className="tm-num">{formatWholeMoney(enquiry.budget.amount_minor, enquiry.budget.currency)}</span> : "No budget given"}
              </Fact>
              <Fact label="Assignee" muted={!enquiry.assignee}>
                {enquiry.assignee?.full_name ?? "Unassigned"}
              </Fact>
              {enquiry.notes && (
                <div className="col-span-2">
                  <Fact label="Notes">{enquiry.notes}</Fact>
                </div>
              )}
            </>
          )}
        </dl>
      )}
    </Panel>
  );
}

const OUTCOMES: { status: QuoteDecisionStatus; icon: typeof CheckCheck }[] = [
  { status: "accepted", icon: CheckCheck },
  { status: "declined", icon: CircleX },
  { status: "expired", icon: Hourglass },
];

function QuoteEditor({ quote }: { quote: QuoteDetail }) {
  const me = useCurrentUser();
  const now = useClock(60_000);
  const enquiry = useQuery(enquiryQueryOptions(quote.enquiry.id));
  const team = useQuery(teamQueryOptions);
  const activity = useQuery(quoteActivityQueryOptions(quote.id));
  const [picks, setPicks] = useState<QuotePick[]>([]);
  const [previewing, setPreviewing] = useState<number | null>(null);
  const [sending, setSending] = useState(false);
  const [outcome, setOutcome] = useState<QuoteDecisionStatus | null>(null);
  const [building, setBuilding] = useState(false);

  const names = useMemo(() => new Map((team.data ?? []).map((member) => [member.id, member.full_name])), [team.data]);
  const pickedIds = useMemo(() => new Set(picks.map((pick) => pick.offer.id)), [picks]);
  const locked = lockedReason(quote, enquiry.data);
  const previewed = quote.versions.find((v) => v.version === previewing) ?? quote.versions[0];
  const sentBefore = quote.sent_version !== null;
  const closed = CLOSED_QUOTE.has(quote.status);

  function toggle(offer: FlightOffer, selected: boolean) {
    if (!selected) setPicks(picks.filter((pick) => pick.offer.id !== offer.id));
    else if (picks.length < MAX_QUOTE_OPTIONS && !pickedIds.has(offer.id)) setPicks([...picks, { offer, markup: "" }]);
  }

  const trip = enquiry.data ? [tripDates(enquiry.data), travellersLabel(enquiry.data), cabinLabel(enquiry.data.cabin)].filter(Boolean).join(" · ") : null;

  return (
    <>
      <PageHeader
        breadcrumb={[...CRUMBS, { label: quote.number }]}
        title={quote.number}
        meta={
          <>
            <StatusPill status={quote.status} />
            <Badge tone="neutral">{quote.currency}</Badge>
          </>
        }
        description={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {quote.client ? (
              <Link to="/app/clients/$clientId" params={{ clientId: quote.client.id }} className="text-primary underline-offset-2 hover:underline">
                {quote.client.name}
              </Link>
            ) : (
              <span className="text-faint">No client</span>
            )}
            <span aria-hidden="true" className="text-faint">
              ·
            </span>
            <Link
              to="/app/enquiries/$enquiryId"
              params={{ enquiryId: quote.enquiry.id }}
              className="font-mono text-ink underline-offset-2 hover:text-primary hover:underline"
            >
              {quote.enquiry.number} {routeLabel(quote.enquiry)}
            </Link>
            {trip && (
              <>
                <span aria-hidden="true" className="text-faint">
                  ·
                </span>
                <span className="font-mono text-ink">{trip}</span>
              </>
            )}
            <span aria-hidden="true" className="text-faint">
              ·
            </span>
            <span>Prices in {quote.currency}</span>
          </span>
        }
        actions={
          <>
            {SENT.has(quote.status) && (
              <Menu
                align="end"
                trigger={
                  <>
                    <ClipboardList size={14} strokeWidth={1.75} aria-hidden="true" className="text-dim" />
                    Record outcome
                    <ChevronDown size={14} aria-hidden="true" className="text-dim" />
                  </>
                }
                items={OUTCOMES.map(({ status, icon }) => ({
                  id: status,
                  label: `Mark ${status}`,
                  icon,
                  danger: status === "declined",
                  onSelect: () => setOutcome(status),
                }))}
              />
            )}
            {!closed && (
              <Button
                size="sm"
                onClick={() => setSending(true)}
                disabled={quote.current_version === 0 || locked !== null}
                title={quote.current_version === 0 ? "Save a version first" : undefined}
              >
                <Send size={14} aria-hidden="true" />
                {sentBefore ? "Re-send to client" : "Send to client"}
              </Button>
            )}
          </>
        }
      />

      <QuoteFigures quote={quote} now={now} />

      {/* The kit's list + detail: building (builder, offers) in span-7, the record (versions, preview, trip,
          timeline) in span-5. At 1180px and below the columns dissolve and the cards stack in reading order:
          what the client sees, the builder, the offers, then the history. */}
      <div className="grid g-12 items-start">
        <div className={COLUMN + " span-7"}>
          <QuoteBuilder
            quote={quote}
            picks={picks}
            onPicksChange={setPicks}
            lockedReason={locked}
            onSaved={() => {
              setPicks([]);
              setPreviewing(null);
            }}
            onBusyChange={setBuilding}
            className={STACKED + " max-[1180.98px]:order-2"}
          />
          <OfferPicker
            quote={quote}
            enquiry={enquiry.data}
            pickedIds={pickedIds}
            lockedReason={locked}
            frozen={building}
            onToggle={toggle}
            className={STACKED + " max-[1180.98px]:order-3"}
          />
        </div>
        <div className={COLUMN + " span-5"}>
          <VersionHistory
            quote={quote}
            previewing={previewed?.version ?? null}
            onPreview={setPreviewing}
            names={names}
            now={now}
            className={STACKED + " max-[1180.98px]:order-4"}
          />
          <VersionPreview
            quote={quote}
            version={previewed}
            author={previewed?.created_by ? names.get(previewed.created_by) : undefined}
            adultsOnly={enquiry.data ? enquiry.data.children_ages.length === 0 : false}
            now={now}
            className={STACKED + " max-[1180.98px]:order-1"}
          />
          <TripPanel quote={quote} enquiry={enquiry.data} loading={enquiry.isPending} className={STACKED + " max-[1180.98px]:order-5"} />
          <TimelinePanel
            timeline={activity}
            intro="Versions, sends and client views"
            emptyDescription="Versions, sends and client views will be listed here as they happen."
            className={STACKED + " max-[1180.98px]:order-6"}
          />
        </div>
      </div>

      {sending && (
        <SendQuoteDialog
          quote={quote}
          agencyName={me?.agency.name ?? null}
          timeZone={me?.agency.timezone ?? "UTC"}
          onClose={() => setSending(false)}
        />
      )}
      {outcome && <QuoteOutcomeDialog quote={quote} status={outcome} onClose={() => setOutcome(null)} />}
    </>
  );
}

function LoadingQuote() {
  return (
    <>
      <PageHeader breadcrumb={[...CRUMBS, { label: "Quote" }]} title="Quote" description={<span aria-hidden="true" className="tm-shimmer mt-1 inline-block h-3.5 w-80 max-w-full rounded-[8px] align-middle" />} />
      <div aria-busy="true" className="grid g-12 items-start">
        <span className="sr-only">Loading quote…</span>
        <div className="span-7 flex flex-col gap-4">
          <Panel title="Build version">
            <Skeleton lines={4} />
          </Panel>
          <Panel title="Find offers">
            <Skeleton lines={3} />
          </Panel>
        </div>
        <div className="span-5 flex flex-col gap-4">
          <Panel title="Versions">
            <Skeleton lines={3} />
          </Panel>
          <Panel title="Preview">
            <Skeleton lines={5} />
          </Panel>
        </div>
      </div>
    </>
  );
}

/** One quote: its priced versions, the fare search to build the next one, and sending it to the client. */
export function QuoteEditorPage() {
  const { quoteId } = useParams({ from: "/app/quotes/$quoteId" });
  const quote = useQuery(quoteQueryOptions(quoteId));

  if (quote.isPending) return <LoadingQuote />;
  if (quote.isError) {
    const error = asApiError(quote.error);
    return (
      <>
        <PageHeader breadcrumb={[...CRUMBS, { label: "Quote" }]} title="Quote" />
        {error.status === 404 ? (
          <div className="card p-0">
            <EmptyState
              icon={SearchX}
              title="Quote not found"
              description="It may have been removed, or the link is from another workspace."
              action={{ label: "Back to quotes", to: "/app/quotes" }}
            />
          </div>
        ) : (
          <PanelError error={quote.error} onRetry={() => void quote.refetch()} retrying={quote.isFetching} />
        )}
      </>
    );
  }
  return <QuoteEditor key={quote.data.id} quote={quote.data} />;
}


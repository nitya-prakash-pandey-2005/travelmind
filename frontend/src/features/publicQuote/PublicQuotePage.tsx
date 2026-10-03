import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { CalendarClock, CalendarX2, CircleCheck, CircleSlash, Clock, Link2Off, ReceiptText, TriangleAlert } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { asApiError, type ApiError } from "../../api/client";
import {
  publicQuoteKeys,
  publicQuoteQueryOptions,
  usePublicQuoteDecision,
  type PublicQuote,
} from "../../api/publicQuotes";
import { formatMoney } from "../../lib/money";
import { useDocumentTitle } from "../../lib/useDocumentTitle";
import { useThemePalette } from "../../theme";
import { ThemeSwitcher } from "../../theme/ThemeSwitcher";
import { Button } from "../../ui/Button";
import { cn } from "../../ui/cn";
import { Skeleton } from "../../ui/Skeleton";
import { accentVars, brandAccent, printCss } from "./brandAccent";
import { DecisionDialog, type Decision } from "./DecisionDialog";
import { carrierName, initials, longDate } from "./format";
import { PublicOptionCard, type OptionState } from "./PublicOptionCard";

const ROOT_ATTR = "data-public-quote";
const WIDTH = "mx-auto w-full max-w-[54rem] px-4 sm:px-6";

/** The client's quote page for /q/$token: standalone, outside the app, with no session. */
export function PublicQuotePage() {
  const { token } = useParams({ from: "/q/$token" });
  return <PublicQuoteView token={token} />;
}

/**
 * The page's frame: the agency's accent (or the theme primary) as custom properties, the agency header with the
 * theme switcher, and a light print sheet. Nothing links back into the app, and no analytics are loaded.
 */
function QuoteFrame({ agency, busy, children }: { agency?: PublicQuote["agency"]; busy?: boolean; children: ReactNode }) {
  const palette = useThemePalette();
  const brand = agency?.brand_color ?? "";
  const style = useMemo(() => accentVars(brandAccent(brand, palette)) as CSSProperties, [brand, palette]);
  const print = useMemo(() => printCss(`[${ROOT_ATTR}]`, brand), [brand]);
  return (
    <div {...{ [ROOT_ATTR]: "" }} style={style} className="flex min-h-dvh flex-col bg-bg text-ink">
      <meta name="robots" content="noindex, nofollow" />
      <meta name="referrer" content="no-referrer" />
      <style>{print}</style>
      <div aria-hidden="true" className="h-1 w-full bg-(--pq-accent)" />
      <header className={cn(WIDTH, "flex items-center justify-between gap-3 py-4")}>
        {agency ? (
          <div className="flex min-w-0 items-center gap-3">
            <span
              aria-hidden="true"
              className="tm-brand-mark grid h-10 w-10 shrink-0 place-items-center rounded-lg text-[13px] font-semibold tracking-[0.02em] text-ink"
            >
              {initials(agency.name)}
            </span>
            <div className="min-w-0">
              <p className="truncate text-[15px] font-semibold leading-5 text-ink">{agency.name}</p>
              <p className="text-xs leading-4 text-dim">Travel quote</p>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2.5 text-[13px] text-dim">
            <span
              aria-hidden="true"
              className="grid h-10 w-10 place-items-center rounded-lg border border-line bg-surface text-dim"
            >
              {busy ? <Skeleton className="h-4 w-4" /> : <ReceiptText size={17} strokeWidth={1.75} />}
            </span>
            Travel quote
          </div>
        )}
        <ThemeSwitcher hideNameBelow="sm" className="print:hidden" />
      </header>
      <main className={cn(WIDTH, "flex flex-1 flex-col pb-14")} aria-busy={busy || undefined}>
        {children}
      </main>
      <footer className={cn(WIDTH, "pb-8 text-xs leading-5 text-faint")}>
        <div className="border-t border-line pt-5">Powered by TravelMind</div>
      </footer>
    </div>
  );
}

/** A full-page message when there is no quote to show. */
function Notice({ icon, title, body, action }: { icon: ReactNode; title: string; body: string; action?: ReactNode }) {
  return (
    <div className="flex flex-1 items-center justify-center py-16">
      <div className="flex max-w-sm flex-col items-center text-center">
        <span aria-hidden="true" className="mb-5 grid h-11 w-11 place-items-center rounded-lg border border-line bg-surface text-dim">
          {icon}
        </span>
        <h1 className="text-xl font-semibold leading-7 tracking-[-0.01em] text-ink">{title}</h1>
        <p className="mt-2 text-sm leading-6 text-dim">{body}</p>
        {action && <div className="mt-6">{action}</div>}
      </div>
    </div>
  );
}

function LoadingQuote() {
  return (
    <div className="pt-8 sm:pt-12">
      <span className="sr-only">Loading your quote…</span>
      <Skeleton className="h-4 w-48" />
      <Skeleton className="mt-5 h-9 w-56" />
      <Skeleton lines={3} className="mt-5 max-w-[38rem]" />
      <div className="mt-12 flex flex-col gap-4">
        <Skeleton className="h-72 rounded-lg" />
        <Skeleton className="h-72 rounded-lg" />
      </div>
    </div>
  );
}

function ErrorNotice({ error, onRetry, retrying }: { error: ApiError; onRetry: () => void; retrying: boolean }) {
  const retry = (
    <Button variant="secondary" onClick={onRetry} loading={retrying}>
      Try again
    </Button>
  );
  if (error.status === 404) {
    return (
      <Notice
        icon={<Link2Off size={18} strokeWidth={1.75} />}
        title="This quote link isn't valid"
        body="Ask your travel agent for a new one."
      />
    );
  }
  if (error.status === 410) {
    return (
      <Notice
        icon={<CalendarX2 size={18} strokeWidth={1.75} />}
        title="This quote has expired"
        body="Ask your travel agent for a fresh one."
      />
    );
  }
  if (error.status === 429) {
    return <Notice icon={<Clock size={18} strokeWidth={1.75} />} title="Too many requests" body={error.message} action={retry} />;
  }
  return (
    <Notice
      icon={<TriangleAlert size={18} strokeWidth={1.75} />}
      title="We couldn't load this quote"
      body={error.message}
      action={retry}
    />
  );
}

/** Where the quote stands once it can no longer be accepted, or right after the client decided. */
function StatusBanner({ quote, justDecided }: { quote: PublicQuote; justDecided: boolean }) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (justDecided) headingRef.current?.focus();
  }, [justDecided]);

  const accepted = quote.accepted_option !== null ? quote.options.find((o) => o.index === quote.accepted_option) : undefined;
  const on = quote.decided_at ? ` on ${longDate(quote.decided_at)}` : "";
  let icon: ReactNode;
  let title: string;
  let body: string;
  if (quote.status === "expired") {
    icon = <CalendarX2 size={18} strokeWidth={1.75} className="text-warn" />;
    title = "This quote has expired.";
    body = "Ask your travel agent for a fresh one. The options below are shown for reference only.";
  } else if (quote.status === "accepted") {
    icon = <CircleCheck size={18} strokeWidth={1.75} className="text-ok" />;
    title = justDecided ? `Thanks — ${quote.agency.name} has been notified.` : "This quote has already been accepted.";
    const which = accepted ? `option ${accepted.index + 1}` : "this quote";
    body = justDecided
      ? `You accepted ${which}${accepted ? ` (${carrierName(accepted)}, ${formatMoney(accepted.sell)})` : ""}. Your travel agent will be in touch to confirm the details.`
      : `You accepted ${which}${on}.`;
  } else if (quote.status === "declined") {
    icon = <CircleSlash size={18} strokeWidth={1.75} className="text-dim" />;
    title = justDecided ? `Thanks — ${quote.agency.name} has been notified.` : "This quote has already been declined.";
    body = justDecided
      ? "You declined this quote. Your travel agent may follow up with other options."
      : `You declined this quote${on}.`;
  } else {
    return null;
  }
  return (
    <section
      aria-labelledby="pq-status"
      className={cn(
        "mt-8 flex gap-3.5 rounded-lg border bg-surface px-4 py-4 sm:px-5",
        justDecided ? "border-(color:--pq-accent)" : "border-line",
      )}
    >
      <span aria-hidden="true" className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-md border border-line bg-surface-2">
        {icon}
      </span>
      <div className="min-w-0">
        <h2 id="pq-status" ref={headingRef} tabIndex={-1} className="text-[15px] font-semibold leading-6 text-ink outline-none">
          {title}
        </h2>
        <p className="mt-0.5 text-[13px] leading-5 text-dim">{body}</p>
      </div>
    </section>
  );
}

function QuoteBody({ token, quote }: { token: string; quote: PublicQuote }) {
  const queryClient = useQueryClient();
  const decide = usePublicQuoteDecision(token);
  const [pending, setPending] = useState<Decision | null>(null);
  const [justDecided, setJustDecided] = useState(false);
  const open = quote.status === "sent" || quote.status === "viewed";
  const greeting = quote.client_first_name ? `Hello ${quote.client_first_name},` : "Hello,";

  function ask(decision: Decision) {
    decide.reset();
    setPending(decision);
  }

  function confirm() {
    if (!pending) return;
    const body =
      pending.kind === "accept"
        ? { decision: "accept" as const, option_index: pending.option.index }
        : { decision: "decline" as const };
    decide.mutate(body, {
      onSuccess: () => {
        setPending(null);
        setJustDecided(true);
      },
      onError: (error) => {
        const status = asApiError(error).status;
        // Decided or expired meanwhile: show the quote as it now stands.
        if (status === 409 || status === 410) {
          setPending(null);
          void queryClient.invalidateQueries({ queryKey: publicQuoteKeys.quote(token) });
        }
      },
    });
  }

  // Once accepted, the chosen option leads.
  const shownOptions =
    quote.status === "accepted" && quote.accepted_option !== null
      ? [...quote.options].sort((a, b) => Number(b.index === quote.accepted_option) - Number(a.index === quote.accepted_option))
      : quote.options;

  function optionState(index: number): OptionState {
    if (quote.status === "accepted" && quote.accepted_option === index) return "accepted";
    return open ? "open" : "closed";
  }

  return (
    <>
      <section className="border-b border-line pb-8 pt-6 sm:pt-10">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] leading-5 text-dim">
          <span>
            Quote <span className="font-mono text-ink">{quote.number}</span>
          </span>
          {open && quote.expires_at && (
            <>
              <span aria-hidden="true" className="text-faint">
                ·
              </span>
              <span className="inline-flex items-center gap-1.5">
                <CalendarClock size={14} strokeWidth={1.75} aria-hidden="true" className="text-faint" />
                <span>Valid until {longDate(quote.expires_at)}</span>
              </span>
            </>
          )}
        </p>
        <h1 className="mt-4 text-[28px] font-semibold leading-9 tracking-[-0.02em] text-ink sm:text-[32px] sm:leading-10">
          {greeting}
        </h1>
        {quote.message && (
          <p className="mt-4 max-w-[40rem] whitespace-pre-line text-[15px] leading-7 text-ink">{quote.message}</p>
        )}
      </section>

      <StatusBanner quote={quote} justDecided={justDecided} />

      <section aria-labelledby="pq-options" className="pt-8">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 id="pq-options" className="text-lg font-semibold leading-7 text-ink">
            {quote.options.length === 1 ? "Your option" : "Your options"}
          </h2>
          <p className="text-[13px] text-dim">
            {quote.options.length} option{quote.options.length === 1 ? "" : "s"} · prices in {quote.currency}
          </p>
        </div>
        <div className="mt-4 flex flex-col gap-4">
          {shownOptions.map((option) => (
            <PublicOptionCard
              key={option.index}
              option={option}
              state={optionState(option.index)}
              onAccept={() => ask({ kind: "accept", option })}
            />
          ))}
        </div>
      </section>

      {open && (
        <section className="mt-6 flex flex-col items-start justify-between gap-3 rounded-lg border border-line bg-surface px-4 py-4 sm:flex-row sm:items-center sm:px-5 print:hidden">
          <div>
            <p className="text-sm font-medium leading-5 text-ink">None of these work for you?</p>
            <p className="mt-0.5 text-[13px] leading-5 text-dim">
              Let {quote.agency.name} know, and they can look at other options.
            </p>
          </div>
          <Button variant="secondary" onClick={() => ask({ kind: "decline" })}>
            Decline this quote
          </Button>
        </section>
      )}

      <DecisionDialog
        decision={pending}
        agencyName={quote.agency.name}
        pending={decide.isPending}
        error={decide.error ? asApiError(decide.error) : null}
        onConfirm={confirm}
        onClose={() => setPending(null)}
      />
    </>
  );
}

/** The client's quote for a share token: the agency's proposal, and its accept or decline. */
export function PublicQuoteView({ token }: { token: string }) {
  const query = useQuery(publicQuoteQueryOptions(token));
  const quote = query.data;
  useDocumentTitle(
    quote ? `Quote ${quote.number} · ${quote.agency.name}` : query.isError ? "Quote unavailable" : "Your travel quote",
  );

  if (quote) {
    return (
      <QuoteFrame agency={quote.agency}>
        <QuoteBody token={token} quote={quote} />
      </QuoteFrame>
    );
  }
  if (query.isError) {
    return (
      <QuoteFrame>
        <ErrorNotice error={asApiError(query.error)} onRetry={() => void query.refetch()} retrying={query.isFetching} />
      </QuoteFrame>
    );
  }
  return (
    <QuoteFrame busy>
      <LoadingQuote />
    </QuoteFrame>
  );
}

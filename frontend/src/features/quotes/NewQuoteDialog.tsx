import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Search, SquareKanban } from "lucide-react";
import { useId, useState } from "react";
import { asApiError } from "../../api/client";
import { enquiriesQueryOptions, type EnquiryOut } from "../../api/enquiries";
import { useCreateQuote, type MarkupKind } from "../../api/quotes";
import { useCurrentUser } from "../../auth/useCurrentUser";
import { Button } from "../../ui/Button";
import { cn } from "../../ui/cn";
import { Dialog } from "../../ui/Dialog";
import { EmptyState } from "../../ui/EmptyState";
import { FormError } from "../../ui/FormError";
import { SegmentedControl } from "../../ui/SegmentedControl";
import { StatusPill } from "../../ui/StatusPill";
import { FIELD_LABEL } from "../../ui/TextField";
import { useToast } from "../../ui/toast/useToast";
import { PanelError } from "../command/PanelError";
import { routeLabel, travellersLabel, tripDates } from "../pipeline/enquiryFacts";
import { parseMarkup } from "./markup";
import { MarkupInput } from "./MarkupControls";

/** The picker lists up to this many enquiries (the API's page limit), newest first. */
const ENQUIRY_LIMIT = 200;
const OPEN_ENQUIRY = new Set(["new", "quoting", "quoted"]);
const KINDS = [
  { value: "percent", label: "Percent" },
  { value: "fixed", label: "Fixed amount" },
] as const;

const SEARCH_INPUT = cn(
  "h-8 w-full rounded-md border border-line-strong bg-surface-2 pl-8 pr-2.5 text-[13px] text-ink placeholder:text-faint",
  "transition-colors duration-150 ease-tm hover:border-faint focus:border-primary",
);

function enquiryLine(enquiry: EnquiryOut): string {
  return [enquiry.client?.name ?? "No client", tripDates(enquiry) ?? "Dates not set", travellersLabel(enquiry)].join(" · ");
}

function EnquiryChoice({ enquiry, checked, onChoose }: { enquiry: EnquiryOut; checked: boolean; onChoose: () => void }) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2 transition-colors duration-150 ease-tm",
        "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-1 has-[:focus-visible]:outline-primary",
        checked ? "border-primary/60 bg-primary/10" : "border-line hover:border-line-strong hover:bg-hover",
      )}
    >
      <input type="radio" name="enquiry" checked={checked} onChange={onChoose} className="sr-only" />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex items-center gap-2 text-[13px]">
          <span className="font-mono text-ink">{enquiry.number}</span>
          <span className="font-mono font-medium text-ink">{routeLabel(enquiry)}</span>
        </span>
        <span className="truncate text-xs text-dim">{enquiryLine(enquiry)}</span>
      </span>
      <StatusPill status={enquiry.status} />
    </label>
  );
}

/** The open enquiries to pick from, with a search box. */
function EnquiryPicker({ chosen, onChoose }: { chosen: string | null; onChoose: (id: string) => void }) {
  const listId = useId();
  const [term, setTerm] = useState("");
  const enquiries = useQuery(enquiriesQueryOptions({ limit: ENQUIRY_LIMIT }));
  const open = (enquiries.data?.items ?? []).filter((item) => OPEN_ENQUIRY.has(item.status));
  const needle = term.trim().toLowerCase();
  const shown = needle
    ? open.filter((item) => [item.number, item.client?.name, routeLabel(item)].filter(Boolean).join(" ").toLowerCase().includes(needle))
    : open;
  return (
    <div className="flex flex-col gap-2">
      <span className={FIELD_LABEL}>Enquiry</span>
      <div className="relative">
        <Search size={14} aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
        <input
          type="search"
          aria-label="Search open enquiries"
          aria-controls={listId}
          placeholder="Number, route or client"
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          className={SEARCH_INPUT}
        />
      </div>
      {enquiries.isError ? (
        <PanelError error={enquiries.error} onRetry={() => void enquiries.refetch()} retrying={enquiries.isFetching} />
      ) : enquiries.isPending ? (
        <p className="text-[13px] text-dim">Loading open enquiries…</p>
      ) : shown.length === 0 ? (
        <EmptyState
          icon={SquareKanban}
          title={open.length === 0 ? "No open enquiries" : "No enquiries match"}
          description={open.length === 0 ? "Quotes answer an enquiry. Add one in the pipeline first." : "Try another number, route or client."}
          className="py-4"
        />
      ) : (
        <div id={listId} role="radiogroup" aria-label="Open enquiries" className="flex max-h-64 flex-col gap-1.5 overflow-y-auto">
          {shown.map((item) => (
            <EnquiryChoice key={item.id} enquiry={item} checked={chosen === item.id} onChoose={() => onChoose(item.id)} />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Start a quote: the enquiry it answers (fixed when opened from one) and its markup — percent or a
 * fixed amount per option — which every version of the quote uses. Opens the new quote in the editor.
 */
export function NewQuoteDialog({ enquiry, onClose }: { enquiry?: EnquiryOut; onClose: () => void }) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const me = useCurrentUser();
  const currency = me?.agency.currency ?? "INR";
  const createQuote = useCreateQuote();
  const [chosen, setChosen] = useState<string | null>(enquiry?.id ?? null);
  const [kind, setKind] = useState<MarkupKind>("percent");
  const [markup, setMarkup] = useState("");
  const parsed = parseMarkup(kind, markup, currency);
  const markupError = "error" in parsed ? parsed.error : null;

  function create() {
    if (!chosen || "error" in parsed) return;
    createQuote.mutate(
      { enquiry_id: chosen, markup_kind: kind, markup_value: parsed.value ?? 0 },
      {
        onSuccess: (quote) => {
          toast({ tone: "ok", title: `Quote ${quote.number} created` });
          onClose();
          void navigate({ to: "/app/quotes/$quoteId", params: { quoteId: quote.id } });
        },
      },
    );
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="New quote"
      description={
        enquiry
          ? `For ${enquiry.number} · ${routeLabel(enquiry)}. Its trip prefills the fare search.`
          : "Pick the open enquiry this quote answers. Its trip prefills the fare search."
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={create} disabled={!chosen || markupError !== null} loading={createQuote.isPending}>
            Create quote
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {createQuote.isError && <FormError error={asApiError(createQuote.error)} />}
        {enquiry ? (
          <div className="flex flex-col gap-1.5">
            <span className={FIELD_LABEL}>Enquiry</span>
            <div className="flex items-center gap-3 rounded-md border border-line bg-surface-2 px-3 py-2">
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="font-mono text-[13px] text-ink">
                  {enquiry.number} {routeLabel(enquiry)}
                </span>
                <span className="truncate text-xs text-dim">{enquiryLine(enquiry)}</span>
              </span>
              <StatusPill status={enquiry.status} />
            </div>
          </div>
        ) : (
          <EnquiryPicker chosen={chosen} onChoose={setChosen} />
        )}
        <div className="flex flex-col gap-1.5">
          <span className={FIELD_LABEL}>Markup type</span>
          <SegmentedControl
            label="Markup type"
            options={KINDS}
            value={kind}
            onChange={(next) => {
              setKind(next);
              setMarkup("");
            }}
            className="self-start"
          />
          <p className="text-xs leading-4 text-dim">
            {kind === "percent"
              ? "A share of each supplier fare. It stays the same for every version of this quote."
              : `An amount in ${currency} added to each option. It stays the same for every version of this quote.`}
          </p>
        </div>
        <MarkupInput
          label={kind === "percent" ? "Markup (%)" : `Markup per option (${currency})`}
          kind={kind}
          currency={currency}
          value={markup}
          onChange={setMarkup}
          placeholder="0"
          error={markupError}
          hint="You can set a different markup on any option when you build a version."
          className="sm:max-w-64"
        />
      </div>
    </Dialog>
  );
}

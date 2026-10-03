import { Check, CircleCheck, Copy, MessageSquareText, TriangleAlert } from "lucide-react";
import { useId, useState } from "react";
import { asApiError } from "../../api/client";
import { SHARE_TTL_DAYS, shareUrl, useSendQuote, type QuoteDetail, type QuoteSent } from "../../api/quotes";
import { Button } from "../../ui/Button";
import { Dialog } from "../../ui/Dialog";
import { FormError } from "../../ui/FormError";
import { FIELD_CONTROL, FIELD_LABEL } from "../../ui/TextField";
import { composeQuoteMessage, optionLine } from "./quoteText";

const DAY_MS = 86_400_000;

function dateIn(timeZone: string, iso: string): string {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone }).format(new Date(iso));
}

type Copied = "link" | "message" | null;

/** A copy button that says "Copied" once its text is on the clipboard. */
function CopyButton({ label, done, onCopy, icon: Icon }: { label: string; done: boolean; onCopy: () => void; icon: typeof Copy }) {
  return (
    <Button variant="secondary" onClick={onCopy} className="shrink-0">
      {done ? <Check size={15} aria-hidden="true" /> : <Icon size={15} aria-hidden="true" />}
      {done ? "Copied" : label}
    </Button>
  );
}

/**
 * Share the quote's current version: a confirmation (with a warning when a re-send replaces a live
 * link), then the link — shown this once — with copy buttons for the link and a ready WhatsApp message.
 */
export function SendQuoteDialog({
  quote,
  agencyName,
  timeZone,
  onClose,
}: {
  quote: QuoteDetail;
  agencyName: string | null;
  timeZone: string;
  onClose: () => void;
}) {
  const linkId = useId();
  const messageId = useId();
  const send = useSendQuote();
  const [sent, setSent] = useState<QuoteSent | null>(null);
  const [copied, setCopied] = useState<Copied>(null);
  // The version being shared: the current one, captured when the dialog opened.
  const [version] = useState(() => quote.versions[0]);
  const resend = quote.sent_version !== null;
  const link = sent ? shareUrl(sent) : "";
  const message = sent && version
    ? composeQuoteMessage({ clientName: quote.client?.name ?? null, options: version.options, expiresAt: sent.expires_at, link, agencyName, timeZone })
    : "";
  const validUntil = dateIn(timeZone, new Date(Date.now() + SHARE_TTL_DAYS * DAY_MS).toISOString());

  async function copy(text: string, what: Exclude<Copied, null>) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
    } catch {
      setCopied(null);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Send ${quote.number} to the client`}
      description={
        version
          ? `Version ${version.version} · ${version.totals.options} option${version.totals.options === 1 ? "" : "s"}${quote.client ? ` · for ${quote.client.name}` : ""}`
          : undefined
      }
      footer={
        sent ? (
          <Button onClick={onClose}>Done</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={() => send.mutate(quote.id, { onSuccess: setSent })} loading={send.isPending} disabled={!version}>
              Create link
            </Button>
          </>
        )
      }
    >
      {sent ? (
        <div className="flex flex-col gap-4">
          <p role="status" className="flex items-center gap-2 text-[13px] text-ok">
            <CircleCheck size={15} aria-hidden="true" className="shrink-0" />
            {quote.number} sent · the link works until {dateIn(timeZone, sent.expires_at)}
          </p>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={linkId} className={FIELD_LABEL}>
              Client link
            </label>
            <div className="flex gap-2 max-sm:flex-col">
              <input
                id={linkId}
                readOnly
                data-autofocus
                value={link}
                onFocus={(event) => event.currentTarget.select()}
                className={`${FIELD_CONTROL} border-line-strong font-mono text-xs`}
              />
              <CopyButton label="Copy link" icon={Copy} done={copied === "link"} onCopy={() => void copy(link, "link")} />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <div className="flex items-end justify-between gap-2">
              <label htmlFor={messageId} className={FIELD_LABEL}>
                WhatsApp message
              </label>
            </div>
            <textarea
              id={messageId}
              readOnly
              rows={9}
              value={message}
              className={`${FIELD_CONTROL} h-auto resize-none border-line-strong py-2 font-mono text-xs leading-5`}
            />
            <div className="flex justify-end">
              <CopyButton
                label="Copy WhatsApp message"
                icon={MessageSquareText}
                done={copied === "message"}
                onCopy={() => void copy(message, "message")}
              />
            </div>
          </div>
          <p className="text-xs leading-4 text-dim">
            This link is shown once. Copy it now. Sending the quote again creates a new link, and this one stops working.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {send.isError && <FormError error={asApiError(send.error)} />}
          {resend && (
            <div role="note" className="flex gap-2.5 rounded-md border border-warn/40 bg-warn/5 px-3 py-2.5 text-[13px] leading-5 text-ink">
              <TriangleAlert size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-warn" />
              <div className="min-w-0">
                <p className="font-medium">Re-sending creates a new link. The link you sent before stops working.</p>
                <p className="mt-0.5 text-dim">
                  {quote.sent_version === version?.version
                    ? "The client already sees this version. Re-send only if they need a fresh link."
                    : `The client now sees version ${quote.sent_version}; after sending they see version ${version?.version}.`}
                </p>
              </div>
            </div>
          )}
          {version && (
            <div className="flex flex-col gap-1.5">
              <p className="tm-micro">The client sees</p>
              <ul className="flex flex-col gap-1 rounded-md border border-line bg-surface-2 px-3 py-2">
                {version.options.map((option, index) => (
                  <li key={`${option.offer.id}-${index}`} className="font-mono text-xs leading-5 text-ink">
                    {optionLine(option, index)}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <ul className="flex flex-col gap-1 text-xs leading-4 text-dim">
            <li>The link works for {SHARE_TTL_DAYS} days, until {validUntil}. The client can accept or decline on any device.</li>
            <li>You'll see here when they open it, accept or decline.</li>
            {quote.status === "draft" && <li>Sending moves {quote.enquiry.number} to Quoted.</li>}
          </ul>
        </div>
      )}
    </Dialog>
  );
}

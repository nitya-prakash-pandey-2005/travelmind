import { CircleAlert } from "lucide-react";
import type { ReactNode } from "react";
import type { ApiError } from "../../api/client";
import type { PublicOption } from "../../api/publicQuotes";
import { formatMoney } from "../../lib/money";
import { Button } from "../../ui/Button";
import { Dialog } from "../../ui/Dialog";
import { AccentButton } from "./AccentButton";
import { PriceLabel } from "./PublicOptionCard";
import { CABIN_LABEL, carrierName, journeyLabel, routeLabel, travelDay } from "./format";

export type Decision = { kind: "accept"; option: PublicOption } | { kind: "decline" };

type DecisionDialogProps = {
  decision: Decision | null;
  agencyName: string;
  pending: boolean;
  /** The refusal to show in the dialog (rate limited, an option that no longer exists, no connection). */
  error: ApiError | null;
  onConfirm: () => void;
  onClose: () => void;
};

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-3 py-2">
      <dt className="text-[13px] text-dim">{label}</dt>
      <dd className="min-w-0 text-[13px] text-ink">{children}</dd>
    </div>
  );
}

/** What the client is about to accept, as a short summary. */
function OptionSummary({ option }: { option: PublicOption }) {
  return (
    <>
      <dl className="divide-y divide-line rounded-md border border-line bg-surface-2/40 px-3">
        <Row label="Airline">
          <span>{carrierName(option)}</span>
          {option.cabin && <span className="text-dim"> · {CABIN_LABEL[option.cabin]}</span>}
        </Row>
        <Row label="Route">
          <span className="font-mono">{routeLabel(option)}</span>
        </Row>
        {option.slices.map((slice, index) => (
          <Row key={`${slice.origin}-${slice.departing_at}`} label={journeyLabel(index, option.slices.length)}>
            {travelDay(slice.departing_at)}
          </Row>
        ))}
        <Row label="Total price">
          <span className="tm-num font-semibold">{formatMoney(option.sell)}</span>
          {option.per_traveller && (
            <span className="text-dim">
              {" · "}
              <span className="tm-num">{formatMoney(option.per_traveller)}</span> per traveller
            </span>
          )}
        </Row>
      </dl>
      <PriceLabel label={option.price_label} className="mt-3" />
    </>
  );
}

/** Confirms the client's accept (of one option) or decline before anything is sent. */
export function DecisionDialog({ decision, agencyName, pending, error, onConfirm, onClose }: DecisionDialogProps) {
  if (!decision) return null;
  const accepting = decision.kind === "accept";
  const number = accepting ? decision.option.index + 1 : 0;
  return (
    <Dialog
      open
      onClose={pending ? () => {} : onClose}
      title={accepting ? `Accept option ${number}?` : "Decline this quote?"}
      description={
        accepting
          ? `${agencyName} will be told you'd like to go ahead, and will be in touch to confirm the details.`
          : `${agencyName} will be told these options don't work for you. They may come back with others.`
      }
      className="print:hidden"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <AccentButton onClick={onConfirm} loading={pending} className="h-9 px-3.5">
            {accepting ? "Confirm acceptance" : "Decline quote"}
          </AccentButton>
        </>
      }
    >
      {accepting ? (
        <OptionSummary option={decision.option} />
      ) : (
        <p className="text-[13px] leading-5 text-dim">
          You won't be able to accept an option from this link afterwards. To look at something different, reply to your
          travel agent.
        </p>
      )}
      {error && (
        <div
          role="alert"
          className="mt-4 flex gap-2.5 rounded-md border border-danger/40 bg-danger/10 px-3 py-2.5 text-[13px] leading-5 text-ink"
        >
          <CircleAlert size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-danger" />
          <p>{error.message}</p>
        </div>
      )}
    </Dialog>
  );
}

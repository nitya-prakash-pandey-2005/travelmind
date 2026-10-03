import { useId, useState, type FormEvent } from "react";
import { MAX_LOST_REASON } from "../../api/enquiries";
import { Button } from "../../ui/Button";
import { Dialog } from "../../ui/Dialog";
import { FIELD_CONTROL, FIELD_LABEL, FieldMessage } from "../../ui/TextField";
import { cn } from "../../ui/cn";

/** Reasons agents give most; one tap fills the field, which stays editable. */
const COMMON_REASONS = ["Booked elsewhere", "Price too high", "Trip cancelled", "No response from client"];
const REQUIRED = "Enter why this enquiry was lost.";

/** The form, mounted only while open so each opening starts empty. */
function LostReasonForm({ number, onCancel, onConfirm }: { number: string; onCancel: () => void; onConfirm: (reason: string) => void }) {
  const id = useId();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | undefined>();
  const errorId = `${id}-error`;
  const countId = `${id}-count`;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = reason.trim();
    if (!text) {
      setError(REQUIRED);
      return;
    }
    onConfirm(text);
  }

  return (
    <Dialog
      open
      onClose={onCancel}
      title={`Mark ${number} as lost`}
      description="The reason shows on the card and in the enquiry's timeline."
      footer={
        <>
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" form={id} variant="danger">
            Mark as lost
          </Button>
        </>
      }
    >
      <form id={id} noValidate onSubmit={submit} className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-reason`} className={FIELD_LABEL}>
            Reason
          </label>
          <textarea
            id={`${id}-reason`}
            data-autofocus=""
            rows={3}
            value={reason}
            maxLength={MAX_LOST_REASON}
            onChange={(event) => {
              setReason(event.target.value);
              if (error) setError(undefined);
            }}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : countId}
            placeholder="What happened? e.g. booked directly with the airline"
            className={cn(FIELD_CONTROL, "h-auto resize-y py-2", error ? "border-danger" : "border-line-strong")}
          />
          {error ? (
            <FieldMessage id={errorId} error>
              {error}
            </FieldMessage>
          ) : (
            <p id={countId} className="text-right font-mono text-[11px] tabular-nums text-faint">
              {reason.length}/{MAX_LOST_REASON}
            </p>
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <p className="tm-micro">Common reasons</p>
          <div className="flex flex-wrap gap-1.5">
            {COMMON_REASONS.map((common) => (
              <button
                key={common}
                type="button"
                aria-pressed={reason === common}
                onClick={() => {
                  setReason(common);
                  setError(undefined);
                }}
                className={cn(
                  "h-7 rounded-full border px-2.5 text-xs transition-colors duration-150 ease-tm",
                  reason === common
                    ? "border-primary/60 bg-selected text-ink"
                    : "border-line-strong bg-surface-2 text-dim hover:border-faint hover:text-ink",
                )}
              >
                {common}
              </button>
            ))}
          </div>
        </div>
      </form>
    </Dialog>
  );
}

/** Asks for the (required) reason before an enquiry moves to Lost. */
export function LostReasonDialog({
  number,
  onCancel,
  onConfirm,
}: {
  /** The enquiry being lost; the dialog is closed while null. */
  number: string | null;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}) {
  return number ? <LostReasonForm number={number} onCancel={onCancel} onConfirm={onConfirm} /> : null;
}

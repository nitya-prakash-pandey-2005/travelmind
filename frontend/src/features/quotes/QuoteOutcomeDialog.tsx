import { asApiError } from "../../api/client";
import { useDecideQuote, type QuoteDecisionStatus, type QuoteDetail } from "../../api/quotes";
import { Button } from "../../ui/Button";
import { Dialog } from "../../ui/Dialog";
import { FormError } from "../../ui/FormError";
import { useToast } from "../../ui/toast/useToast";

const EFFECT: Record<QuoteDecisionStatus, (quote: QuoteDetail) => string> = {
  accepted: (quote) =>
    `Use this when the client accepted by phone, email or in person. ${quote.enquiry.number} moves to Won, and the quote can't be changed afterwards.`,
  declined: (quote) =>
    `${quote.enquiry.number} moves to Lost unless another of its quotes is still open. The quote can't be changed afterwards.`,
  expired: () => "The client's link stops counting as open. You can still revise the quote and send it again.",
};

/** Record a decision the client gave outside their quote link, after a confirmation. */
export function QuoteOutcomeDialog({ quote, status, onClose }: { quote: QuoteDetail; status: QuoteDecisionStatus; onClose: () => void }) {
  const { toast } = useToast();
  const decide = useDecideQuote();
  const action = `Mark ${status}`;

  function confirm() {
    decide.mutate(
      { id: quote.id, status },
      {
        onSuccess: () => {
          toast({ tone: status === "accepted" ? "ok" : "info", title: `${quote.number} marked ${status}` });
          onClose();
        },
      },
    );
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Mark ${quote.number} ${status}?`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant={status === "declined" ? "danger" : "primary"} onClick={confirm} loading={decide.isPending}>
            {action}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {decide.isError && <FormError error={asApiError(decide.error)} />}
        <p className="text-[13px] leading-5 text-ink">{EFFECT[status](quote)}</p>
        {quote.client && <p className="text-xs leading-4 text-dim">Client: {quote.client.name}</p>}
      </div>
    </Dialog>
  );
}

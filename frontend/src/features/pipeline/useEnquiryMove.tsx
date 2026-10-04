import { useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { asApiError } from "../../api/client";
import {
  enquiryKeys,
  useSetEnquiryStatus,
  type EnquiryList,
  type EnquiryOut,
  type EnquiryStatus,
} from "../../api/enquiries";
import { useToast } from "../../ui/toast/useToast";
import { canMove, stageLabel } from "./enquiryFacts";
import { LostReasonDialog } from "./LostReasonDialog";

type Movable = Pick<EnquiryOut, "id" | "number" | "status">;

type MoveOptions = {
  /**
   * Called when the enquiry lands in a stage: at once in its new stage, and back in its old one if the
   * server refuses. The board uses it to keep keyboard focus on the moved card.
   */
  onPlaced?: (id: string, status: EnquiryStatus) => void;
};

function isEnquiryList(value: unknown): value is EnquiryList {
  return typeof value === "object" && value !== null && Array.isArray((value as EnquiryList).items);
}

/**
 * Moves an enquiry between stages, the same way from the board, the list and the enquiry page: Lost asks
 * for a reason first; the move shows at once in every cached list and detail, and a refusal puts back
 * only that enquiry (another move made meanwhile stays) and toasts the server's message. Either way the
 * enquiry records refetch once the server has answered.
 */
export function useEnquiryMove({ onPlaced }: MoveOptions = {}): {
  move: (enquiry: Movable, to: EnquiryStatus) => void;
  dialog: ReactNode;
} {
  const queryClient = useQueryClient();
  const setStatus = useSetEnquiryStatus();
  const { toast } = useToast();
  const [losing, setLosing] = useState<Movable | null>(null);

  /** Writes `change` into the enquiry wherever it is cached (every list and its detail). */
  function patchCached(id: string, change: (item: EnquiryOut) => EnquiryOut) {
    const apply = (item: EnquiryOut) => (item.id === id ? change(item) : item);
    queryClient.setQueriesData<unknown>({ queryKey: [...enquiryKeys.all, "list"] }, (old: unknown) =>
      isEnquiryList(old) ? { ...old, items: old.items.map(apply) } : old,
    );
    queryClient.setQueryData<EnquiryOut>(enquiryKeys.detail(id), (old) => (old ? apply(old) : old));
  }

  /** The enquiry as cached before the move: its detail, else its first appearance in a list. */
  function cachedBefore(id: string): EnquiryOut | undefined {
    const detail = queryClient.getQueryData<EnquiryOut>(enquiryKeys.detail(id));
    if (detail) return detail;
    for (const [, data] of queryClient.getQueriesData<unknown>({ queryKey: [...enquiryKeys.all, "list"] })) {
      const found = isEnquiryList(data) ? data.items.find((item) => item.id === id) : undefined;
      if (found) return found;
    }
    return undefined;
  }

  async function commit(enquiry: Movable, to: EnquiryStatus, lostReason?: string) {
    await queryClient.cancelQueries({ queryKey: enquiryKeys.all });
    const before = cachedBefore(enquiry.id);
    const from = { status: enquiry.status, lost_reason: before?.lost_reason ?? null };
    patchCached(enquiry.id, (item) => ({
      ...item,
      status: to,
      lost_reason: lostReason ?? (to === "lost" ? item.lost_reason : null),
    }));
    onPlaced?.(enquiry.id, to);
    try {
      await setStatus.mutateAsync({ id: enquiry.id, status: to, ...(lostReason ? { lost_reason: lostReason } : {}) });
      toast({ tone: "ok", title: `${enquiry.number} moved to ${stageLabel(to)}` });
    } catch (error) {
      // Only this enquiry goes back: a snapshot of whole lists would also undo moves made meanwhile.
      patchCached(enquiry.id, (item) => ({ ...item, ...from }));
      onPlaced?.(enquiry.id, enquiry.status);
      toast({ tone: "danger", title: `Couldn't move ${enquiry.number}`, description: asApiError(error).message });
    } finally {
      // Settled either way: refetch so every list matches the server.
      void queryClient.invalidateQueries({ queryKey: enquiryKeys.all });
    }
  }

  function move(enquiry: Movable, to: EnquiryStatus) {
    if (!canMove(enquiry.status, to)) return;
    if (to === "lost") setLosing(enquiry);
    else void commit(enquiry, to);
  }

  const dialog = (
    <LostReasonDialog
      number={losing?.number ?? null}
      onCancel={() => setLosing(null)}
      onConfirm={(reason) => {
        const enquiry = losing;
        setLosing(null);
        if (enquiry) void commit(enquiry, "lost", reason);
      }}
    />
  );

  return { move, dialog };
}

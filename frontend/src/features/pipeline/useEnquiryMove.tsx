import { useQueryClient, type QueryKey } from "@tanstack/react-query";
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

function isEnquiryList(value: unknown): value is EnquiryList {
  return typeof value === "object" && value !== null && Array.isArray((value as EnquiryList).items);
}

/**
 * Moves an enquiry between stages, the same way from the board, the list and the enquiry page: Lost asks
 * for a reason first; the move shows at once in every cached list and detail, and a refusal puts them
 * back and toasts the server's message.
 */
export function useEnquiryMove(): { move: (enquiry: Movable, to: EnquiryStatus) => void; dialog: ReactNode } {
  const queryClient = useQueryClient();
  const setStatus = useSetEnquiryStatus();
  const { toast } = useToast();
  const [losing, setLosing] = useState<Movable | null>(null);

  async function commit(enquiry: Movable, to: EnquiryStatus, lostReason?: string) {
    await queryClient.cancelQueries({ queryKey: enquiryKeys.all });
    const snapshot: [QueryKey, unknown][] = [
      ...queryClient.getQueriesData<unknown>({ queryKey: [...enquiryKeys.all, "list"] }),
      [enquiryKeys.detail(enquiry.id), queryClient.getQueryData(enquiryKeys.detail(enquiry.id))],
    ];
    const moved = (item: EnquiryOut): EnquiryOut =>
      item.id === enquiry.id ? { ...item, status: to, lost_reason: lostReason ?? (to === "lost" ? item.lost_reason : null) } : item;
    queryClient.setQueriesData<unknown>({ queryKey: [...enquiryKeys.all, "list"] }, (old: unknown) =>
      isEnquiryList(old) ? { ...old, items: old.items.map(moved) } : old,
    );
    queryClient.setQueryData<EnquiryOut>(enquiryKeys.detail(enquiry.id), (old) => (old ? moved(old) : old));
    try {
      await setStatus.mutateAsync({ id: enquiry.id, status: to, ...(lostReason ? { lost_reason: lostReason } : {}) });
      toast({ tone: "ok", title: `${enquiry.number} moved to ${stageLabel(to)}` });
    } catch (error) {
      for (const [queryKey, data] of snapshot) queryClient.setQueryData(queryKey, data);
      toast({ tone: "danger", title: `Couldn't move ${enquiry.number}`, description: asApiError(error).message });
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

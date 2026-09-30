import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { authApi } from "../api/auth";
import { qk } from "../api/queries";
import { useToast } from "../ui/toast/useToast";
import { resetSessionState } from "./resetSessionState";

export const EXIT_DEMO_FAILED = "Couldn't leave the demo. Try again.";

/**
 * Ends a demo session and returns to the public home page, forgetting every bit of the demo's data.
 * If the server didn't end the session, nothing is forgotten: a toast says so and the page stays.
 */
export function useExitDemo() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { toast } = useToast();
  return useMutation({
    mutationFn: () => authApi.exitDemo(),
    meta: { skipAuthRedirect: true },
    onSuccess: async () => {
      resetSessionState(queryClient);
      queryClient.setQueryData(qk.me, null);
      await navigate({ to: "/" });
    },
    onError: () => {
      toast({ tone: "danger", title: EXIT_DEMO_FAILED });
    },
  });
}

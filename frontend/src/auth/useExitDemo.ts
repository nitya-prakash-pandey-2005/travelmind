import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { authApi } from "../api/auth";
import { qk } from "../api/queries";
import { resetSessionState } from "./resetSessionState";

/** Ends a demo session and returns to the public home page, forgetting every bit of the demo's data. */
export function useExitDemo() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  return useMutation({
    mutationFn: () => authApi.exitDemo(),
    meta: { skipAuthRedirect: true },
    onSettled: async () => {
      resetSessionState(queryClient);
      queryClient.setQueryData(qk.me, null);
      await navigate({ to: "/" });
    },
  });
}

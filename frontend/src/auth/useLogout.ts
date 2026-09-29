import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { authApi } from "../api/auth";
import { qk } from "../api/queries";
import { resetSessionState } from "./resetSessionState";

export function useLogout() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  return useMutation({
    mutationFn: () => authApi.logout(),
    onSettled: async () => {
      resetSessionState(queryClient);
      queryClient.setQueryData(qk.me, null);
      await navigate({ to: "/login" });
    },
  });
}

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { authApi } from "../api/auth";
import { qk } from "../api/queries";
import { routeStore } from "../features/route/routeStore";

export function useLogout() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  return useMutation({
    mutationFn: () => authApi.logout(),
    onSettled: async () => {
      routeStore.reset();
      queryClient.setQueryData(qk.me, null);
      queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== qk.me[0] });
      await navigate({ to: "/login" });
    },
  });
}

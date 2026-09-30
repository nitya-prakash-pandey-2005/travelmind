import { afterEach, expect, test } from "vitest";
import { qk } from "../api/queries";
import { createQueryClient } from "../api/queryClient";
import { workspaceKeys } from "../api/workspace";
import { routeStore } from "../features/route/routeStore";
import { AIRPORTS, ME_OWNER } from "../test/fixtures";
import { resetSessionState } from "./resetSessionState";

afterEach(() => routeStore.reset());

test("drops every cached query but me (team, workspace, notifications, search), and clears the scanned route", () => {
  const queryClient = createQueryClient({ retry: false });
  queryClient.setQueryData(qk.me, ME_OWNER);
  queryClient.setQueryData(qk.team, [{ id: "u-agent" }]);
  queryClient.setQueryData(qk.invitations, []);
  queryClient.setQueryData(qk.airports("goa"), [AIRPORTS.GOI]);
  queryClient.setQueryData(qk.suppliers, []);
  queryClient.setQueryData(workspaceKeys.agency, { ...ME_OWNER.agency, demo_expires_at: null });
  queryClient.setQueryData(workspaceKeys.notifications, { unread: 1, items: [] });
  queryClient.setQueryData(workspaceKeys.search("priya"), { clients: [], enquiries: [], quotes: [] });
  queryClient.setQueryData(workspaceKeys.onboarding, { items: [], completed: 0, total: 6 });
  routeStore.set({ origin: AIRPORTS.DEL, destination: AIRPORTS.BOM });

  resetSessionState(queryClient);

  expect(queryClient.getQueryCache().getAll().map((query) => query.queryKey)).toEqual([qk.me]);
  expect(queryClient.getQueryData(qk.me)).toEqual(ME_OWNER);
  expect(routeStore.get()).toEqual({ origin: null, destination: null });
});

test("a request still in flight cannot refill the cache afterwards", async () => {
  const queryClient = createQueryClient({ retry: false });
  let respond!: (team: unknown[]) => void;
  const fetching = queryClient
    .fetchQuery({ queryKey: qk.team, queryFn: () => new Promise<unknown[]>((resolve) => (respond = resolve)) })
    .catch(() => undefined);

  resetSessionState(queryClient);
  respond([{ id: "u-agent" }]);
  await fetching;

  expect(queryClient.getQueryData(qk.team)).toBeUndefined();
});

import { createMemoryHistory } from "@tanstack/react-router";
import { render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createQueryClient } from "../api/queryClient";
import type { Me } from "../api/types";
import { AppProviders } from "../app/AppProviders";
import { createAppRouter } from "../router";
import type { MockHandler } from "./mockApi";

export function renderApp(path: string) {
  const queryClient = createQueryClient({ retry: false });
  const router = createAppRouter(queryClient, createMemoryHistory({ initialEntries: [path] }));
  const user = userEvent.setup();
  const result = render(<AppProviders queryClient={queryClient} router={router} />);
  return { ...result, router, queryClient, user };
}

/** Mock routes for a signed-in (or signed-out, with null) user plus a healthy API. */
export function withSession(me: Me | null, extra: Record<string, MockHandler> = {}): Record<string, MockHandler> {
  return {
    "GET /api/v1/auth/me": me ? { status: 200, body: me } : { status: 401, body: { detail: "Please sign in." } },
    "GET /health": { status: 200, body: { status: "ok", database: "ok" } },
    ...extra,
  };
}

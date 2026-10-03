import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import { ApiError } from "./client";
import { qk } from "./queries";

let unauthorizedHandler: (() => void) | null = null;

/** The router registers how to leave the app when the session is gone. */
export function setUnauthorizedHandler(handler: (() => void) | null): void {
  unauthorizedHandler = handler;
}

function shouldRetry(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError && error.status > 0 && error.status < 500) return false;
  return failureCount < 2;
}

export function createQueryClient({ retry = true }: { retry?: boolean } = {}): QueryClient {
  const handleAuthError = (error: unknown) => {
    if (error instanceof ApiError && error.status === 401) {
      client.setQueryData(qk.me, null);
      unauthorizedHandler?.();
    }
  };
  const client: QueryClient = new QueryClient({
    queryCache: new QueryCache({
      onError: (error, query) => {
        if (!query.meta?.skipAuthRedirect) handleAuthError(error);
      },
    }),
    mutationCache: new MutationCache({
      onError: (error, _variables, _context, mutation) => {
        if (!mutation.meta?.skipAuthRedirect) handleAuthError(error);
      },
    }),
    defaultOptions: {
      queries: { refetchOnWindowFocus: false, retry: retry ? shouldRetry : false },
      mutations: { retry: false },
    },
  });
  return client;
}

import { queryOptions, skipToken } from "@tanstack/react-query";
import { apiFetch } from "./client";
import type { Agency } from "./types";

/** GET /api/v1/agency: the profile plus, for a demo workspace, when it is deleted. */
export type AgencyProfile = Agency & { demo_expires_at: string | null };

/** Known notification kinds; the feed may carry others, which render with a generic icon. */
export type NotificationKind =
  | "quote.viewed"
  | "quote.accepted"
  | "quote.declined"
  | "enquiry.assigned"
  | "team.joined";

export type NotificationItem = {
  id: string;
  kind: NotificationKind | (string & {});
  summary: string;
  /** ISO 8601 UTC. */
  occurred_at: string;
  read: boolean;
};

/** `unread` counts every unseen event, not only the (at most 20) items listed. */
export type NotificationsResponse = { unread: number; items: NotificationItem[] };

export type ClientHit = { id: string; name: string; email: string | null; company_name: string | null };
export type EnquiryHit = {
  id: string;
  number: string;
  origin: string | null;
  destination: string | null;
  status: string;
};
export type QuoteHit = { id: string; number: string; status: string; client_name: string | null };
export type SearchResponse = { clients: ClientHit[]; enquiries: EnquiryHit[]; quotes: QuoteHit[] };

export type OnboardingKey = "profile" | "supplier" | "team" | "fare_scan" | "client" | "quote";
export type OnboardingItem = { key: OnboardingKey; label: string; done: boolean; href: string };
export type OnboardingResponse = { items: OnboardingItem[]; completed: number; total: number };

/** The server rejects shorter terms (after trimming). */
export const MIN_SEARCH_LENGTH = 2;

export const workspaceApi = {
  agency: (signal?: AbortSignal) => apiFetch<AgencyProfile>("/api/v1/agency", { signal }),
  notifications: (signal?: AbortSignal) => apiFetch<NotificationsResponse>("/api/v1/notifications", { signal }),
  markNotificationsSeen: () => apiFetch<void>("/api/v1/notifications/seen", { method: "POST" }),
  search: (term: string, signal?: AbortSignal) =>
    apiFetch<SearchResponse>(`/api/v1/search?q=${encodeURIComponent(term)}`, { signal }),
  onboarding: (signal?: AbortSignal) => apiFetch<OnboardingResponse>("/api/v1/onboarding", { signal }),
};

/** Workspace query keys. All of them belong to the session and are dropped by resetSessionState. */
export const workspaceKeys = {
  agency: ["agency"] as const,
  notifications: ["notifications"] as const,
  search: (term: string) => ["search", term.toLowerCase()] as const,
  onboarding: ["onboarding"] as const,
};

export const agencyQueryOptions = queryOptions({
  queryKey: workspaceKeys.agency,
  queryFn: ({ signal }) => workspaceApi.agency(signal),
  staleTime: 5 * 60_000,
});

export const notificationsQueryOptions = queryOptions({
  queryKey: workspaceKeys.notifications,
  queryFn: ({ signal }) => workspaceApi.notifications(signal),
  refetchInterval: 60_000,
});

export function recordSearchQueryOptions(term: string) {
  const trimmed = term.trim();
  return queryOptions({
    queryKey: workspaceKeys.search(trimmed),
    queryFn: trimmed.length >= MIN_SEARCH_LENGTH ? ({ signal }) => workspaceApi.search(trimmed, signal) : skipToken,
    staleTime: 30_000,
  });
}

export const onboardingQueryOptions = queryOptions({
  queryKey: workspaceKeys.onboarding,
  queryFn: ({ signal }) => workspaceApi.onboarding(signal),
});

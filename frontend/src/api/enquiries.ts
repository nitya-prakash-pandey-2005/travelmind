import { mutationOptions, queryOptions, useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { apiFetch } from "./client";
import type { Cabin, Money } from "./offers";
import { TIMELINE_STALE_MS, type Timeline } from "./timeline";
import { queryString, RECORD_ROOTS, refreshWorkspace, segment } from "./workspaceCache";

/** Enquiries, field for field with backend/src/travelmind/workspace/enquiries.py. */

export type EnquiryStatus = "new" | "quoting" | "quoted" | "won" | "lost";
export type EnquirySource = "manual" | "pasted" | "copilot";

/** Where an enquiry may move from each status (the backend's ALLOWED); anything else is a 409. */
export const ENQUIRY_TRANSITIONS: Record<EnquiryStatus, readonly EnquiryStatus[]> = {
  new: ["quoting", "quoted", "lost"],
  quoting: ["quoted", "lost"],
  quoted: ["won", "lost", "quoting"],
  lost: ["new"],
  won: [],
};

/** A lost reason is required when moving to lost, up to this many characters. */
export const MAX_LOST_REASON = 200;

export type EnquiryOut = {
  id: string;
  number: string;
  client: { id: string; name: string } | null;
  source: EnquirySource;
  raw_text: string | null;
  origin: string | null;
  destination: string | null;
  /** Agency-local calendar days, YYYY-MM-DD. */
  depart_date: string | null;
  return_date: string | null;
  adults: number;
  children_ages: number[];
  cabin: Cabin;
  budget: Money | null;
  notes: string | null;
  status: EnquiryStatus;
  lost_reason: string | null;
  assignee: { id: string; full_name: string } | null;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  quote_count: number;
};
export type EnquiryList = { items: EnquiryOut[]; total: number };

/** POST /api/v1/enquiries: omitted fields take the server's defaults. */
export type EnquiryCreate = {
  client_id?: string;
  source?: EnquirySource;
  raw_text?: string;
  origin?: string;
  destination?: string;
  depart_date?: string;
  return_date?: string;
  adults?: number;
  children_ages?: number[];
  cabin?: Cabin;
  budget_minor?: number;
  budget_currency?: string;
  notes?: string;
  assignee_user_id?: string;
};

/**
 * PATCH /api/v1/enquiries/{id}: omitted fields are left alone; null clears an optional field. adults,
 * children_ages and cabin can't be null. Cross-field rules are checked against the result.
 */
export type EnquiryUpdate = {
  client_id?: string | null;
  origin?: string | null;
  destination?: string | null;
  depart_date?: string | null;
  return_date?: string | null;
  adults?: number;
  children_ages?: number[];
  cabin?: Cabin;
  budget_minor?: number | null;
  budget_currency?: string | null;
  notes?: string | null;
  assignee_user_id?: string | null;
};

export type EnquiryStatusChange = { status: EnquiryStatus; lost_reason?: string };

/** GET /api/v1/enquiries filters; the server allows limit 1–200 (default 50). */
export type EnquiryFilters = {
  status?: EnquiryStatus;
  assignee?: string;
  q?: string;
  limit?: number;
  offset?: number;
};

const BASE = "/api/v1/enquiries";

export const enquiriesApi = {
  list: (filters: EnquiryFilters = {}, signal?: AbortSignal) =>
    apiFetch<EnquiryList>(`${BASE}${queryString(filters)}`, { signal }),
  get: (id: string, signal?: AbortSignal) => apiFetch<EnquiryOut>(`${BASE}/${segment(id)}`, { signal }),
  create: (body: EnquiryCreate) => apiFetch<EnquiryOut>(BASE, { method: "POST", body }),
  update: (id: string, body: EnquiryUpdate) =>
    apiFetch<EnquiryOut>(`${BASE}/${segment(id)}`, { method: "PATCH", body }),
  setStatus: (id: string, body: EnquiryStatusChange) =>
    apiFetch<EnquiryOut>(`${BASE}/${segment(id)}/status`, { method: "POST", body }),
  activity: (id: string, signal?: AbortSignal) =>
    apiFetch<Timeline>(`${BASE}/${segment(id)}/activity`, { signal }),
};

/** Every key starts with "enquiries" (shared with the Command Center's enquiry list). */
export const enquiryKeys = {
  all: RECORD_ROOTS.enquiries,
  list: (filters: EnquiryFilters) => [...RECORD_ROOTS.enquiries, "list", filters] as const,
  detail: (id: string) => [...RECORD_ROOTS.enquiries, "detail", id] as const,
  activity: (id: string) => [...RECORD_ROOTS.enquiries, "activity", id] as const,
};

export function enquiriesQueryOptions(filters: EnquiryFilters = {}) {
  return queryOptions({
    queryKey: enquiryKeys.list(filters),
    queryFn: ({ signal }) => enquiriesApi.list(filters, signal),
    staleTime: 30_000,
  });
}

export function enquiryQueryOptions(id: string) {
  return queryOptions({
    queryKey: enquiryKeys.detail(id),
    queryFn: ({ signal }) => enquiriesApi.get(id, signal),
    staleTime: 30_000,
  });
}

export function enquiryActivityQueryOptions(id: string) {
  return queryOptions({
    queryKey: enquiryKeys.activity(id),
    queryFn: ({ signal }) => enquiriesApi.activity(id, signal),
    staleTime: TIMELINE_STALE_MS,
  });
}

function stored(client: QueryClient, enquiry: EnquiryOut): void {
  client.setQueryData(enquiryKeys.detail(enquiry.id), enquiry);
  refreshWorkspace(client);
}

export function createEnquiryMutation(client: QueryClient) {
  return mutationOptions({
    mutationFn: (body: EnquiryCreate) => enquiriesApi.create(body),
    onSuccess: (enquiry) => stored(client, enquiry),
  });
}

export function updateEnquiryMutation(client: QueryClient) {
  return mutationOptions({
    mutationFn: ({ id, changes }: { id: string; changes: EnquiryUpdate }) => enquiriesApi.update(id, changes),
    onSuccess: (enquiry) => stored(client, enquiry),
  });
}

/** Move an enquiry; a 409 carries the server's "Can't move an enquiry from X to Y." */
export function setEnquiryStatusMutation(client: QueryClient) {
  return mutationOptions({
    mutationFn: ({ id, ...change }: { id: string } & EnquiryStatusChange) => enquiriesApi.setStatus(id, change),
    onSuccess: (enquiry) => stored(client, enquiry),
  });
}

export const useCreateEnquiry = () => useMutation(createEnquiryMutation(useQueryClient()));
export const useUpdateEnquiry = () => useMutation(updateEnquiryMutation(useQueryClient()));
export const useSetEnquiryStatus = () => useMutation(setEnquiryStatusMutation(useQueryClient()));

import { mutationOptions, queryOptions, useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { apiFetch } from "./client";
import { TIMELINE_STALE_MS, type Timeline } from "./timeline";
import { queryString, RECORD_ROOTS, refreshWorkspace, segment } from "./workspaceCache";

/** Clients, field for field with backend/src/travelmind/workspace/clients.py. */

export type ClientKind = "individual" | "company";

/** A trip from one of the client's enquiries (not lost, with both airports and a departure date). */
export type TripRef = { origin: string; destination: string; /** YYYY-MM-DD */ depart_date: string };

export type ClientOut = {
  id: string;
  kind: ClientKind;
  name: string;
  email: string | null;
  phone: string | null;
  company_name: string | null;
  home_airport: string | null;
  notes: string | null;
  tags: string[];
  created_at: string;
  updated_at: string;
  enquiry_count: number;
  quote_count: number;
  /** Accepted quotes' value in `currency` (the agency's), minor units; 0 when none. */
  won_value_minor: number;
  currency: string;
  /** The trip with the latest departure on or before today (agency-local). */
  last_trip: TripRef | null;
  /** The trip with the earliest departure after today. */
  next_trip: TripRef | null;
};
export type ClientList = { items: ClientOut[]; total: number };

/** At most this many tags per client. */
export const MAX_CLIENT_TAGS = 10;

/** POST /api/v1/clients: only the name is required. */
export type ClientCreate = {
  kind?: ClientKind;
  name: string;
  email?: string | null;
  phone?: string | null;
  company_name?: string | null;
  home_airport?: string | null;
  notes?: string | null;
  tags?: string[];
};

/** PATCH /api/v1/clients/{id}: omitted fields are left alone; null clears an optional field. */
export type ClientUpdate = {
  kind?: ClientKind;
  name?: string;
  email?: string | null;
  phone?: string | null;
  company_name?: string | null;
  home_airport?: string | null;
  notes?: string | null;
  tags?: string[];
};

/** GET /api/v1/clients filters; the server allows limit 1–200 (default 50). */
export type ClientFilters = { q?: string; tag?: string; limit?: number; offset?: number };

const BASE = "/api/v1/clients";

export const clientsApi = {
  list: (filters: ClientFilters = {}, signal?: AbortSignal) =>
    apiFetch<ClientList>(`${BASE}${queryString(filters)}`, { signal }),
  get: (id: string, signal?: AbortSignal) => apiFetch<ClientOut>(`${BASE}/${segment(id)}`, { signal }),
  create: (body: ClientCreate) => apiFetch<ClientOut>(BASE, { method: "POST", body }),
  update: (id: string, body: ClientUpdate) => apiFetch<ClientOut>(`${BASE}/${segment(id)}`, { method: "PATCH", body }),
  /** 409 "This client has quotes, so it can't be deleted." when it has any. */
  remove: (id: string) => apiFetch<void>(`${BASE}/${segment(id)}`, { method: "DELETE" }),
  activity: (id: string, signal?: AbortSignal) => apiFetch<Timeline>(`${BASE}/${segment(id)}/activity`, { signal }),
};

/** Every key starts with "clients" (shared with the New enquiry dialog's suggestions). */
export const clientKeys = {
  all: RECORD_ROOTS.clients,
  list: (filters: ClientFilters) => [...RECORD_ROOTS.clients, "list", filters] as const,
  detail: (id: string) => [...RECORD_ROOTS.clients, "detail", id] as const,
  activity: (id: string) => [...RECORD_ROOTS.clients, "activity", id] as const,
};

export function clientsQueryOptions(filters: ClientFilters = {}) {
  return queryOptions({
    queryKey: clientKeys.list(filters),
    queryFn: ({ signal }) => clientsApi.list(filters, signal),
    staleTime: 30_000,
  });
}

export function clientQueryOptions(id: string) {
  return queryOptions({
    queryKey: clientKeys.detail(id),
    queryFn: ({ signal }) => clientsApi.get(id, signal),
    staleTime: 30_000,
  });
}

export function clientActivityQueryOptions(id: string) {
  return queryOptions({
    queryKey: clientKeys.activity(id),
    queryFn: ({ signal }) => clientsApi.activity(id, signal),
    staleTime: TIMELINE_STALE_MS,
  });
}

function stored(client: QueryClient, record: ClientOut): void {
  client.setQueryData(clientKeys.detail(record.id), record);
  refreshWorkspace(client);
}

export function createClientMutation(client: QueryClient) {
  return mutationOptions({
    mutationFn: (body: ClientCreate) => clientsApi.create(body),
    onSuccess: (record) => stored(client, record),
  });
}

export function updateClientMutation(client: QueryClient) {
  return mutationOptions({
    mutationFn: ({ id, changes }: { id: string; changes: ClientUpdate }) => clientsApi.update(id, changes),
    onSuccess: (record) => stored(client, record),
  });
}

export function deleteClientMutation(client: QueryClient) {
  return mutationOptions({
    mutationFn: (id: string) => clientsApi.remove(id),
    onSuccess: (_result, id) => {
      client.removeQueries({ queryKey: clientKeys.detail(id) });
      client.removeQueries({ queryKey: clientKeys.activity(id) });
      refreshWorkspace(client);
    },
  });
}

export const useCreateClient = () => useMutation(createClientMutation(useQueryClient()));
export const useUpdateClient = () => useMutation(updateClientMutation(useQueryClient()));
export const useDeleteClient = () => useMutation(deleteClientMutation(useQueryClient()));

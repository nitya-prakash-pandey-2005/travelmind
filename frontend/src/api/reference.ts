import { apiFetch } from "./client";
import type { Airport } from "./types";

export const referenceApi = {
  searchAirports(q: string, limit = 8, signal?: AbortSignal): Promise<Airport[]> {
    const params = new URLSearchParams({ q, limit: String(limit) });
    return apiFetch<Airport[]>(`/api/v1/reference/airports?${params}`, { signal });
  },
};

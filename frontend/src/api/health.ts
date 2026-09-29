import { ApiError, apiFetch } from "./client";

export type ApiHealth = "ok" | "degraded" | "down";

export async function checkHealth(signal?: AbortSignal): Promise<ApiHealth> {
  try {
    await apiFetch<unknown>("/health", { signal });
    return "ok";
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    if (error instanceof ApiError && error.status === 503) return "degraded";
    return "down";
  }
}

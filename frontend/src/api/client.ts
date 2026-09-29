export const NETWORK_ERROR_MESSAGE = "Can't reach TravelMind right now. Check your connection and try again.";
const SERVER_ERROR_MESSAGE = "Something went wrong on our side. Please try again.";
const REQUEST_ERROR_MESSAGE = "That request didn't work. Please try again.";

export class ApiError extends Error {
  readonly status: number;
  readonly fieldErrors: Record<string, string>;
  readonly traceId?: string;

  constructor(status: number, message: string, fieldErrors: Record<string, string> = {}, traceId?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.fieldErrors = fieldErrors;
    this.traceId = traceId;
  }
}

type RequestOptions = { method?: string; body?: unknown; signal?: AbortSignal };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toApiError(status: number, payload: unknown, requestId: string | null): ApiError {
  const body = isRecord(payload) ? payload : {};
  const detail =
    typeof body.detail === "string" ? body.detail : status >= 500 ? SERVER_ERROR_MESSAGE : REQUEST_ERROR_MESSAGE;
  const fieldErrors: Record<string, string> = {};
  if (Array.isArray(body.errors)) {
    for (const item of body.errors) {
      if (isRecord(item) && typeof item.field === "string" && typeof item.message === "string") {
        fieldErrors[item.field] = item.message;
      }
    }
  }
  const traceId =
    typeof body.trace_id === "string" ? body.trace_id : status >= 500 ? (requestId ?? undefined) : undefined;
  return new ApiError(status, detail, fieldErrors, traceId);
}

/** Same-origin JSON request. The session travels as the httpOnly cookie; we never touch tokens. */
export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const hasBody = options.body !== undefined;
  let response: Response;
  try {
    response = await fetch(path, {
      method: options.method ?? "GET",
      credentials: "include",
      headers: hasBody ? { "Content-Type": "application/json" } : undefined,
      body: hasBody ? JSON.stringify(options.body) : undefined,
      signal: options.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ApiError(0, NETWORK_ERROR_MESSAGE);
  }
  if (response.status === 204) return undefined as T;
  const requestId = response.headers.get("X-Request-ID");
  let payload: unknown;
  try {
    payload = await response.json();
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    // A success status with an unreadable body (SPA fallback HTML, captive portal) is not usable data.
    if (response.ok) throw new ApiError(response.status, SERVER_ERROR_MESSAGE, {}, requestId ?? undefined);
    payload = null;
  }
  if (!response.ok) throw toApiError(response.status, payload, requestId);
  return payload as T;
}

export function asApiError(error: unknown): ApiError {
  return error instanceof ApiError ? error : new ApiError(0, "Something went wrong. Please try again.");
}

/**
 * A form shows the general message unless every field error is already shown inline on one of
 * `renderedFields`; otherwise an error for a field the form doesn't render (a URL token, a select)
 * would leave the user with nothing on screen.
 */
export function needsGeneralError(error: ApiError, renderedFields: readonly string[]): boolean {
  const fields = Object.keys(error.fieldErrors);
  return fields.length === 0 || fields.some((field) => !renderedFields.includes(field));
}

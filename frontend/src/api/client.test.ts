import { expect, test, vi } from "vitest";
import { mockApi } from "../test/mockApi";
import { ME_OWNER } from "../test/fixtures";
import { authApi } from "./auth";
import { ApiError, NETWORK_ERROR_MESSAGE, apiFetch, asApiError, needsGeneralError } from "./client";
import { checkHealth } from "./health";
import { referenceApi } from "./reference";

test("sends JSON with credentials and returns the parsed body", async () => {
  const { fetchMock, calls } = mockApi({ "POST /api/v1/auth/login": { status: 200, body: ME_OWNER } });
  await expect(authApi.login({ email: "asha@alphatravels.in", password: "x".repeat(12) })).resolves.toEqual(ME_OWNER);
  const init = fetchMock.mock.calls[0]?.[1];
  expect(init?.credentials).toBe("include");
  expect(init?.headers).toEqual({ "Content-Type": "application/json" });
  expect(calls[0]?.body).toEqual({ email: "asha@alphatravels.in", password: "x".repeat(12) });
});

test("204 responses resolve to undefined", async () => {
  mockApi({ "POST /api/v1/auth/logout": { status: 204 } });
  await expect(authApi.logout()).resolves.toBeUndefined();
});

test("validation errors become field errors", async () => {
  mockApi({
    "POST /api/v1/auth/signup": {
      status: 422,
      body: {
        detail: "Some of the information you entered isn't valid.",
        errors: [{ field: "password", message: "String should have at least 10 characters" }],
      },
    },
  });
  const error = await authApi
    .signup({ agency_name: "Alpha", full_name: "Asha", email: "a@b.in", password: "short" })
    .catch((e: unknown) => e);
  expect(error).toBeInstanceOf(ApiError);
  expect((error as ApiError).status).toBe(422);
  expect((error as ApiError).message).toBe("Some of the information you entered isn't valid.");
  expect((error as ApiError).fieldErrors).toEqual({ password: "String should have at least 10 characters" });
});

test("server errors carry the trace ID", async () => {
  mockApi({
    "GET /api/v1/team": {
      status: 500,
      body: { detail: "Something went wrong on our side. Please try again.", trace_id: "abc123" },
    },
  });
  const error = (await apiFetch("/api/v1/team").catch((e: unknown) => e)) as ApiError;
  expect(error.status).toBe(500);
  expect(error.traceId).toBe("abc123");
});

test("a non-JSON gateway error still gives a plain message and the request ID", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("<html>Bad gateway</html>", { status: 502, headers: { "X-Request-ID": "req-9" } })),
  );
  const error = (await apiFetch("/api/v1/team").catch((e: unknown) => e)) as ApiError;
  expect(error.status).toBe(502);
  expect(error.message).toBe("Something went wrong on our side. Please try again.");
  expect(error.traceId).toBe("req-9");
});

test("network failures become a friendly ApiError with status 0", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))));
  const error = (await apiFetch("/api/v1/team").catch((e: unknown) => e)) as ApiError;
  expect(error.status).toBe(0);
  expect(error.message).toBe(NETWORK_ERROR_MESSAGE);
});

test("aborted requests are rethrown untouched", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new DOMException("aborted", "AbortError"))));
  await expect(apiFetch("/api/v1/team")).rejects.toMatchObject({ name: "AbortError" });
});

test("me() returns null when signed out", async () => {
  mockApi({ "GET /api/v1/auth/me": { status: 401, body: { detail: "Please sign in." } } });
  await expect(authApi.me()).resolves.toBeNull();
});

test("airport search encodes the query", async () => {
  const { calls } = mockApi({ "GET /api/v1/reference/airports": { status: 200, body: [] } });
  await referenceApi.searchAirports("são paulo", 5);
  expect(calls[0]?.search.get("q")).toBe("são paulo");
  expect(calls[0]?.search.get("limit")).toBe("5");
});

test("health maps 200 / 503 / network failure", async () => {
  mockApi({ "GET /health": { status: 200, body: { status: "ok", database: "ok" } } });
  await expect(checkHealth()).resolves.toBe("ok");
  mockApi({ "GET /health": { status: 503, body: { status: "degraded", database: "unavailable" } } });
  await expect(checkHealth()).resolves.toBe("degraded");
  vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))));
  await expect(checkHealth()).resolves.toBe("down");
});

test("asApiError wraps unknown errors", () => {
  const wrapped = asApiError(new Error("boom"));
  expect(wrapped).toBeInstanceOf(ApiError);
  expect(wrapped.message).toBe("Something went wrong. Please try again.");
  const original = new ApiError(409, "Taken");
  expect(asApiError(original)).toBe(original);
});

test("a 200 with a non-JSON body is a plain server error, not null data", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("<html>ok</html>", { status: 200, headers: { "X-Request-ID": "req-7" } })),
  );
  const error = (await apiFetch("/api/v1/team").catch((e: unknown) => e)) as ApiError;
  expect(error).toBeInstanceOf(ApiError);
  expect(error.message).toBe("Something went wrong on our side. Please try again.");
  expect(error.traceId).toBe("req-7");
});

test("a 200 with an empty body rejects with an ApiError", async () => {
  mockApi({ "GET /api/v1/team": { status: 200 } });
  await expect(apiFetch("/api/v1/team")).rejects.toBeInstanceOf(ApiError);
});

test("a form needs the general message unless every field error is shown inline", () => {
  const inline = ["email", "password"] as const;
  expect(needsGeneralError(new ApiError(409, "Taken"), inline)).toBe(true);
  expect(needsGeneralError(new ApiError(422, "Invalid", { email: "Bad email" }), inline)).toBe(false);
  expect(needsGeneralError(new ApiError(422, "Invalid", { email: "Bad", password: "Short" }), inline)).toBe(false);
  expect(needsGeneralError(new ApiError(422, "Invalid", { token: "Too short" }), inline)).toBe(true);
  expect(needsGeneralError(new ApiError(422, "Invalid", { email: "Bad", role: "Unknown" }), inline)).toBe(true);
});

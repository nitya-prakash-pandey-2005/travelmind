import { vi } from "vitest";

export type MockResult = { status: number; body?: unknown; headers?: Record<string, string> };
export type MockCall = { method: string; path: string; search: URLSearchParams; body: unknown };
/** A fixed result, or a function of the call; an async function holds the request in flight until it resolves. */
export type MockHandler = MockResult | ((call: MockCall) => MockResult | Promise<MockResult>);

/** Stub global fetch with a route table keyed by "METHOD /path" (query string ignored). */
export function mockApi(routes: Record<string, MockHandler>) {
  const calls: MockCall[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input), "http://localhost");
    const method = (init.method ?? "GET").toUpperCase();
    const call: MockCall = {
      method,
      path: url.pathname,
      search: url.searchParams,
      body: typeof init.body === "string" ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);
    const handler = routes[`${method} ${url.pathname}`];
    const result: MockResult = !handler
      ? { status: 404, body: { detail: `No mock for ${method} ${url.pathname}` } }
      : typeof handler === "function"
        ? await handler(call)
        : handler;
    const body = result.body === undefined ? null : JSON.stringify(result.body);
    return new Response(body, {
      status: result.status,
      headers: { "Content-Type": "application/json", ...result.headers },
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return { calls, fetchMock };
}

import { act } from "@testing-library/react";
import { vi } from "vitest";

type Listener = (event: MessageEvent) => void;

/**
 * A stand-in for the browser's EventSource: every instance is recorded, and a test drives it with
 * `open()`, `step()`, `status()` and `fail()` (each inside act). Install with `installFakeEventSource()`.
 */
export class FakeEventSource {
  static instances: FakeEventSource[] = [];
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;

  readonly url: string;
  readonly withCredentials: boolean;
  readyState = FakeEventSource.CONNECTING;
  onopen: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onmessage: Listener | null = null;
  private listeners = new Map<string, Set<Listener>>();

  constructor(url: string | URL, init?: { withCredentials?: boolean }) {
    this.url = String(url);
    this.withCredentials = Boolean(init?.withCredentials);
    FakeEventSource.instances.push(this);
  }

  /** The newest connection. */
  static get latest(): FakeEventSource {
    const last = FakeEventSource.instances[FakeEventSource.instances.length - 1];
    if (!last) throw new Error("No EventSource was opened.");
    return last;
  }

  /** The `last_event_id` the connection asked to resume after. */
  get lastEventId(): string | null {
    return new URL(this.url, "http://localhost").searchParams.get("last_event_id");
  }

  get closed(): boolean {
    return this.readyState === FakeEventSource.CLOSED;
  }

  addEventListener(type: string, listener: Listener) {
    const set = this.listeners.get(type) ?? new Set<Listener>();
    set.add(listener);
    this.listeners.set(type, set);
  }

  removeEventListener(type: string, listener: Listener) {
    this.listeners.get(type)?.delete(listener);
  }

  close() {
    this.readyState = FakeEventSource.CLOSED;
  }

  private dispatch(type: string, data: unknown, lastEventId = "") {
    if (this.closed) return;
    const event = new MessageEvent(type, { data: JSON.stringify(data), lastEventId });
    if (type === "message") this.onmessage?.(event);
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }

  open() {
    act(() => {
      this.readyState = FakeEventSource.OPEN;
      this.onopen?.(new Event("open"));
    });
  }

  /** An `event: step` with its seq as the event id. */
  step(step: { seq: number; [key: string]: unknown }) {
    act(() => this.dispatch("step", step, String(step.seq)));
  }

  /** An `event: status` carrying the run. */
  status(run: unknown) {
    act(() => this.dispatch("status", run));
  }

  /** The connection drops (the browser fires `error`). */
  fail() {
    act(() => {
      this.readyState = FakeEventSource.CONNECTING;
      this.onerror?.(new Event("error"));
    });
  }
}

export function installFakeEventSource(): typeof FakeEventSource {
  FakeEventSource.instances = [];
  vi.stubGlobal("EventSource", FakeEventSource);
  return FakeEventSource;
}

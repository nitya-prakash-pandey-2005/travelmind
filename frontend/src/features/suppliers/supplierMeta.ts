import { BedDouble, ChartLine, Coins, Leaf, Plane, type LucideIcon } from "lucide-react";
import type { SupplierHealth } from "../../api/dashboard";
import type { SupplierStatus } from "../../api/offers";
import { formatNumber } from "../../lib/format";
import type { BadgeTone } from "../../ui/Badge";

export type SupplierKind = SupplierStatus["kind"];

/** What each kind of source provides, in words, with its icon. */
export const KIND: Record<SupplierKind, { label: string; icon: LucideIcon }> = {
  flights: { label: "Flights", icon: Plane },
  hotels: { label: "Hotels", icon: BedDouble },
  emissions: { label: "CO₂ data", icon: Leaf },
  price_history: { label: "Fare history", icon: ChartLine },
  exchange_rates: { label: "Exchange rates", icon: Coins },
};

export const MODE: Record<NonNullable<SupplierStatus["mode"]>, { tone: BadgeTone; label: string }> = {
  live: { tone: "ok", label: "Live" },
  test: { tone: "info", label: "Test" },
  sandbox: { tone: "warn", label: "Sandbox" },
};

/** The API process's circuit breaker for a supplier (the status endpoint sends it; older servers may not). */
export type BreakerState = "closed" | "open" | "half_open";

export const BREAKER: Record<BreakerState, { tone: BadgeTone; label: string }> = {
  closed: { tone: "neutral", label: "Breaker closed" },
  half_open: { tone: "warn", label: "Breaker half-open" },
  open: { tone: "danger", label: "Breaker open" },
};

/** The breaker state, when the server sent one. */
export function breakerOf(s: SupplierStatus): BreakerState | null {
  const value = (s as SupplierStatus & { breaker?: unknown }).breaker;
  return value === "closed" || value === "open" || value === "half_open" ? value : null;
}

/** Sources that answer searches with offers; the rest add data to results. */
export const isBooking = (s: SupplierStatus) => s.kind === "flights" || s.kind === "hotels";

const PCT = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });

export const ms = (value: number) => `${formatNumber(Math.round(value))} ms`;

/** "42 calls · 95.2% ok". */
export function callsLine(h: SupplierHealth): string {
  return `${formatNumber(h.calls)} call${h.calls === 1 ? "" : "s"} · ${PCT.format(h.success_pct)}% ok`;
}

/** "p50 180 ms · p95 420 ms", or null when no call succeeded (no latency to report). */
export function latencyLine(h: SupplierHealth): string | null {
  if (h.p50_ms === null || h.p95_ms === null) return null;
  return `p50 ${ms(h.p50_ms)} · p95 ${ms(h.p95_ms)}`;
}

/** Same bands as the Command Center: healthy from 95 % success, degraded from 80 %, failing below. */
export function healthOf(h: SupplierHealth): { status: "ok" | "degraded" | "down" | "unknown"; word: string } {
  if (h.calls === 0) return { status: "unknown", word: "No calls" };
  if (h.success_pct >= 95) return { status: "ok", word: "Healthy" };
  if (h.success_pct >= 80) return { status: "degraded", word: "Degraded" };
  return { status: "down", word: "Failing" };
}

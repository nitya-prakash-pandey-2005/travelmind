/**
 * GET /api/v1/{enquiries|clients|quotes}/{id}/activity, field for field with the backend's TimelineOut:
 * newest first, at most 50 items.
 */
export type TimelineItem = {
  id: string;
  /** e.g. "enquiry.created", "quote.viewed"; unknown kinds render with a generic icon. */
  kind: string;
  summary: string;
  /** ISO 8601 UTC. */
  occurred_at: string;
  /** null for the system or the client (a quote opened, accepted or declined from its link). */
  actor: { id: string; full_name: string } | null;
};

export type Timeline = { items: TimelineItem[] };

/** Timelines change whenever their record does; a short stale time keeps a revisit fresh. */
export const TIMELINE_STALE_MS = 15_000;

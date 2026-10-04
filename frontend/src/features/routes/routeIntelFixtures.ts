import type { RouteIntel } from "../../api/routeIntel";
import { ME_OWNER } from "../../test/fixtures";
import type { MockCall, MockHandler } from "../../test/mockApi";
import { withSession } from "../../test/renderApp";
import { commandCenterMocks } from "../../test/workspaceFixtures";

/** Test data for route intel, field for field with backend/src/travelmind/fareintel/routes.py. */

const HOUR = 3_600_000;

/** An ISO timestamp `hours` ago, on the hour (route intel truncates its update time to the hour). */
export function hoursAgo(hours: number): string {
  const at = new Date(Date.now() - hours * HOUR);
  at.setUTCMinutes(0, 0, 0);
  return at.toISOString();
}

export const DEL_BOM: RouteIntel = {
  origin: "DEL",
  destination: "BOM",
  cabin: "economy",
  currency: "INR",
  family: "market",
  daily: [
    { date: "2026-09-29", p25_minor: 410_000, median_minor: 462_000, p75_minor: 530_000, samples: 7 },
    { date: "2026-09-30", p25_minor: 420_000, median_minor: 471_050, p75_minor: 545_000, samples: 9 },
    { date: "2026-10-01", p25_minor: 415_000, median_minor: 468_000, p75_minor: 520_000, samples: 6 },
    { date: "2026-10-02", p25_minor: 430_000, median_minor: 490_000, p75_minor: 552_000, samples: 11 },
    { date: "2026-10-03", p25_minor: 430_000, median_minor: 475_000, p75_minor: 540_000, samples: 9 },
  ],
  by_days_out: [
    { bucket: "0-7", median_minor: 610_000, samples: 12 },
    { bucket: "8-21", median_minor: 495_000, samples: 14 },
    { bucket: "22-45", median_minor: 452_000, samples: 16 },
  ],
  carriers: [
    { code: "6E", samples: 20, median_minor: 470_000 },
    { code: "AI", samples: 14, median_minor: 520_000 },
    { code: "UK", samples: 8, median_minor: 505_000 },
  ],
  your_searches: [
    { created_at: hoursAgo(2), cheapest_minor: 455_000, adults: 2 },
    { created_at: hoursAgo(30), cheapest_minor: 498_000, adults: 1 },
  ],
  updated_at: hoursAgo(1),
};

export const EMPTY_ROUTE: RouteIntel = {
  ...DEL_BOM,
  family: null,
  daily: [],
  by_days_out: [],
  carriers: [],
  your_searches: [],
  updated_at: null,
};

/** The shell, the Command Center's suggestion sources (a busy agency) and route intel answering `intel`. */
export function routeIntelMocks(
  intel: RouteIntel | ((call: MockCall) => RouteIntel) = DEL_BOM,
  extra: Record<string, MockHandler> = {},
): Record<string, MockHandler> {
  return withSession(ME_OWNER, {
    ...commandCenterMocks({ populated: true }),
    "GET /api/v1/routes/intel": (call) => {
      const body = typeof intel === "function" ? intel(call) : intel;
      return {
        status: 200,
        body: {
          ...body,
          origin: call.search.get("origin") ?? body.origin,
          destination: call.search.get("destination") ?? body.destination,
          cabin: call.search.get("cabin") ?? body.cabin,
        },
      };
    },
    ...extra,
  });
}

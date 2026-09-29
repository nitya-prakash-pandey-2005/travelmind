import { expect, test, vi } from "vitest";
import { AIRPORTS } from "../../test/fixtures";
import { loadRecentRoutes, recordRecentRoute } from "./recentRoutes";

const T = new Date("2026-09-29T10:00:00Z");

test("records newest first and survives a reload", () => {
  recordRecentRoute("u1", AIRPORTS.DEL, AIRPORTS.BOM, T);
  recordRecentRoute("u1", AIRPORTS.LHR, AIRPORTS.JFK, T);
  const routes = loadRecentRoutes("u1");
  expect(routes.map((r) => `${r.origin.iata_code}-${r.destination.iata_code}`)).toEqual(["LHR-JFK", "DEL-BOM"]);
  expect(routes[0]?.scannedAt).toBe("2026-09-29T10:00:00.000Z");
});

test("re-scanning a route moves it to the top instead of duplicating it", () => {
  recordRecentRoute("u1", AIRPORTS.DEL, AIRPORTS.BOM, T);
  recordRecentRoute("u1", AIRPORTS.LHR, AIRPORTS.JFK, T);
  recordRecentRoute("u1", AIRPORTS.DEL, AIRPORTS.BOM, T);
  expect(loadRecentRoutes("u1").map((r) => r.origin.iata_code)).toEqual(["DEL", "LHR"]);
});

test("keeps at most 8 routes", () => {
  const codes = Object.values(AIRPORTS);
  for (const a of codes) for (const b of codes) if (a !== b) recordRecentRoute("u1", a, b, T);
  expect(loadRecentRoutes("u1")).toHaveLength(8);
});

test("each user has their own history", () => {
  recordRecentRoute("u1", AIRPORTS.DEL, AIRPORTS.BOM, T);
  expect(loadRecentRoutes("u2")).toEqual([]);
});

test("corrupted or foreign data is ignored", () => {
  window.localStorage.setItem("tm-recent-routes:u1", "{not json");
  expect(loadRecentRoutes("u1")).toEqual([]);
  window.localStorage.setItem("tm-recent-routes:u1", JSON.stringify([{ origin: "DEL" }]));
  expect(loadRecentRoutes("u1")).toEqual([]);
});

test("still works when storage is blocked", () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("SecurityError");
  });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("SecurityError");
  });
  const routes = recordRecentRoute("u1", AIRPORTS.DEL, AIRPORTS.BOM, T);
  expect(routes).toHaveLength(1);
  expect(loadRecentRoutes("u1")).toEqual([]);
});

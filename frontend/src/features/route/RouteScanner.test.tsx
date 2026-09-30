import { screen } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { AIRPORTS } from "../../test/fixtures";
import { mockApi } from "../../test/mockApi";
import { renderWithClient } from "../../test/renderWithClient";
import { RouteScanner } from "./RouteScanner";
import { routeStore } from "./routeStore";

beforeEach(() => {
  routeStore.reset();
  mockApi({});
});

test("shows distance and an estimated flight time for a route", () => {
  routeStore.set({ origin: AIRPORTS.DEL, destination: AIRPORTS.BOM });
  renderWithClient(<RouteScanner />);
  expect(screen.getByText("1,138")).toBeInTheDocument();
  expect(screen.getByText("615 nmi")).toBeInTheDocument();
  expect(screen.getByText("1h 58m")).toBeInTheDocument();
  expect(screen.getByText(/estimate/i)).toBeInTheDocument();
});

test("reports a ready route exactly once per pair", () => {
  const onRouteReady = vi.fn();
  routeStore.set({ origin: AIRPORTS.DEL, destination: AIRPORTS.BOM });
  const { rerender } = renderWithClient(<RouteScanner onRouteReady={onRouteReady} />);
  rerender(<RouteScanner onRouteReady={onRouteReady} />);
  expect(onRouteReady).toHaveBeenCalledOnce();
  expect(onRouteReady).toHaveBeenCalledWith(AIRPORTS.DEL, AIRPORTS.BOM);
});

test("warns when both ends are the same airport", () => {
  routeStore.set({ origin: AIRPORTS.DEL, destination: AIRPORTS.DEL });
  renderWithClient(<RouteScanner />);
  expect(screen.getByRole("alert")).toHaveTextContent("Pick two different airports.");
  expect(screen.queryByText("Great-circle distance")).not.toBeInTheDocument();
});

test("swap flips the route", async () => {
  routeStore.set({ origin: AIRPORTS.DEL, destination: AIRPORTS.BOM });
  const { user } = renderWithClient(<RouteScanner />);
  await user.click(screen.getByRole("button", { name: "Swap origin and destination" }));
  expect(routeStore.get()).toEqual({ origin: AIRPORTS.BOM, destination: AIRPORTS.DEL });
});

test("a ready route offers a fare scan when the page provides one", async () => {
  const onScanFares = vi.fn();
  routeStore.set({ origin: AIRPORTS.DEL, destination: AIRPORTS.BOM });
  const { user } = renderWithClient(<RouteScanner onScanFares={onScanFares} />);
  await user.click(screen.getByRole("button", { name: "Scan fares for this route" }));
  expect(onScanFares).toHaveBeenCalledOnce();
});

test("without a ready route there is nothing to scan yet", () => {
  routeStore.set({ origin: AIRPORTS.DEL, destination: null });
  renderWithClient(<RouteScanner onScanFares={vi.fn()} />);
  expect(screen.queryByRole("button", { name: "Scan fares for this route" })).not.toBeInTheDocument();
  expect(screen.getByText("Pick two airports to scan fares.")).toBeInTheDocument();
});

test("a ready route without a fare scan shows no hint to pick airports", () => {
  routeStore.set({ origin: AIRPORTS.DEL, destination: AIRPORTS.BOM });
  renderWithClient(<RouteScanner />);
  expect(screen.queryByText("Pick two airports to scan fares.")).not.toBeInTheDocument();
});

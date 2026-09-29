import { beforeEach, expect, test } from "vitest";
import { AIRPORTS } from "../../test/fixtures";
import { routeStore } from "./routeStore";

beforeEach(() => routeStore.reset());

test("place fills origin, then destination, then replaces destination", () => {
  routeStore.place(AIRPORTS.DEL);
  expect(routeStore.get()).toEqual({ origin: AIRPORTS.DEL, destination: null });
  routeStore.place(AIRPORTS.BOM);
  expect(routeStore.get()).toEqual({ origin: AIRPORTS.DEL, destination: AIRPORTS.BOM });
  routeStore.place(AIRPORTS.GOI);
  expect(routeStore.get()).toEqual({ origin: AIRPORTS.DEL, destination: AIRPORTS.GOI });
});

test("swap exchanges origin and destination and notifies subscribers", () => {
  let notified = 0;
  const unsubscribe = routeStore.subscribe(() => {
    notified += 1;
  });
  routeStore.set({ origin: AIRPORTS.DEL, destination: AIRPORTS.BOM });
  routeStore.swap();
  expect(routeStore.get()).toEqual({ origin: AIRPORTS.BOM, destination: AIRPORTS.DEL });
  expect(notified).toBe(2);
  unsubscribe();
});

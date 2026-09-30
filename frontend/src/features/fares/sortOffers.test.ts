import { expect, test } from "vitest";
import { makeOffer } from "../../test/offerFixtures";
import { sortOffers } from "./sortOffers";

const cheapSlow = makeOffer({ id: "a", total_duration_minutes: 300, co2_kg_per_passenger: 180 });
const dearFast = makeOffer({ id: "b", total_duration_minutes: 130, co2_kg_per_passenger: null });
const midGreen = makeOffer({ id: "c", total_duration_minutes: 200, co2_kg_per_passenger: 90 });
const ranked = [cheapSlow, dearFast, midGreen];

test("cheapest keeps the server's ranking", () => {
  expect(sortOffers(ranked, "price").map((o) => o.id)).toEqual(["a", "b", "c"]);
});

test("fastest and greenest re-sort; unknown values go last", () => {
  expect(sortOffers(ranked, "duration").map((o) => o.id)).toEqual(["b", "c", "a"]);
  expect(sortOffers(ranked, "co2").map((o) => o.id)).toEqual(["c", "a", "b"]);
});

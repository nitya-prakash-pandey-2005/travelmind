import { expect, test } from "vitest";
import { PROVENANCE } from "./provenance";

test("every provenance has one label, shared by flights and hotels", () => {
  expect(PROVENANCE.LIVE).toEqual({ tone: "ok", label: "Live" });
  expect(PROVENANCE.CACHED).toEqual({ tone: "warn", label: "Cached · indicative" });
  expect(PROVENANCE.SANDBOX).toEqual({ tone: "ai", label: "Sandbox · not bookable" });
});

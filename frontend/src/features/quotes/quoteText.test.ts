import { expect, test } from "vitest";
import { makeOffer, segment } from "../../test/offerFixtures";
import { AIR_INDIA, INDIGO, quoteOption } from "./quoteFixtures";
import { composeQuoteMessage, firstName, optionLine } from "./quoteText";

test("first names come from the client's name", () => {
  expect(firstName("Priya Sharma")).toBe("Priya");
  expect(firstName("  Rahul  ")).toBe("Rahul");
  expect(firstName("")).toBeNull();
  expect(firstName(null)).toBeNull();
});

test("an option is one line: carrier, each journey's times and the sell price", () => {
  expect(optionLine(quoteOption(INDIGO, 52_340, 576_000), 0)).toBe("Option 1 · IndiGo · DEL 06:10 → BOM 08:20 · ₹5,760");
  const roundTrip = makeOffer({
    passenger_count: 2,
    slices: [
      { origin: "DEL", destination: "BOM", duration_minutes: 130, fare_brand: null, stops: 0, segments: [segment("DEL", "BOM", "2026-11-20T06:10:00", "2026-11-20T08:20:00")] },
      {
        origin: "BOM",
        destination: "DEL",
        duration_minutes: 300,
        fare_brand: null,
        stops: 1,
        segments: [
          segment("BOM", "HYD", "2026-11-27T18:00:00", "2026-11-27T19:30:00"),
          segment("HYD", "DEL", "2026-11-27T20:30:00", "2026-11-27T23:00:00"),
        ],
      },
    ],
  });
  expect(optionLine(quoteOption(roundTrip, 0, 1_152_050), 1)).toBe(
    "Option 2 · IndiGo · DEL 06:10 → BOM 08:20 · BOM 18:00 → DEL 23:00 (1 stop) · ₹11,520.50 for 2 travellers",
  );
});

test("the WhatsApp message greets the client, lists every option, the expiry and the link", () => {
  const text = composeQuoteMessage({
    client: { name: "Priya Sharma", kind: "individual" },
    options: [quoteOption(INDIGO, 52_340, 576_000), quoteOption(AIR_INDIA, 61_200)],
    expiresAt: "2026-10-14T09:00:00Z",
    link: "https://app.example/q/tok_abc",
    agencyName: "Orbit Travel Co.",
  });
  expect(text).toBe(
    [
      "Hello Priya,",
      "",
      "Here are your flight options for DEL → BOM:",
      "",
      "Option 1 · IndiGo · DEL 06:10 → BOM 08:20 · ₹5,760",
      "Option 2 · Air India · DEL 09:00 → BOM 11:10 · ₹6,732",
      "",
      "See the details and accept the one you like here (valid until 14 Oct 2026):",
      "https://app.example/q/tok_abc",
      "",
      "Orbit Travel Co.",
    ].join("\n"),
  );
});

test("without a client name or an agency the message still reads well", () => {
  const text = composeQuoteMessage({ client: null, options: [quoteOption(INDIGO, 0)], expiresAt: null, link: "https://x/q/t" });
  expect(text.startsWith("Hello,\n")).toBe(true);
  expect(text).toContain("Here is your flight option for DEL → BOM:");
  expect(text).toContain("See the details and accept it here:\nhttps://x/q/t");
  expect(text.endsWith("https://x/q/t")).toBe(true);
});

test("a company client is greeted without a first name, as on its quote page", () => {
  const text = composeQuoteMessage({
    client: { name: "Nimbus Analytics", kind: "company" },
    options: [quoteOption(INDIGO, 0)],
    expiresAt: null,
    link: "https://x/q/t",
  });
  expect(text.startsWith("Hello,\n")).toBe(true);
  expect(text).not.toContain("Nimbus");
});

test("the expiry date is the agency's local date", () => {
  const text = composeQuoteMessage({
    client: null,
    options: [quoteOption(INDIGO, 0)],
    expiresAt: "2026-10-14T20:00:00Z",
    link: "https://x/q/t",
    timeZone: "Asia/Kolkata",
  });
  expect(text).toContain("(valid until 15 Oct 2026)");
});

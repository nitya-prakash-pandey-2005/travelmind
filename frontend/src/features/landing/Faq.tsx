import { cn } from "../../ui/cn";
import { Kicker } from "./Kicker";
import { ANCHOR, CONTAINER, SECTION_LEAD, SECTION_TITLE, SECTION_Y } from "./layout";

type Entry = { question: string; answer: string };

/** Answers checked against the product: keep them in step with the backend and the signup form. */
const FAQ: Entry[] = [
  {
    question: "Where do fares and hotel rates come from?",
    answer:
      "Flights come from Duffel and hotels from LiteAPI. Emissions are Google's Travel Impact Model estimates, fare history comes from Travelpayouts, conversions use ECB reference rates and airport data comes from OurAirports.",
  },
  {
    question: "What do Live, Cached and Sandbox mean?",
    answer:
      "Live prices came back from the supplier in this search. Cached prices are indicative, drawn from recently recorded fares, and may have changed. Sandbox prices are supplier test inventory and can't be booked.",
  },
  {
    question: "Does the demo cost anything?",
    answer:
      "No. The demo opens a private workspace with sample clients and enquiries. There is no sign-up and no payment details are asked for, and the workspace is deleted after 7 days.",
  },
  {
    question: "Can another agency see our data?",
    answer:
      "No. Every workspace table is protected by PostgreSQL row-level security, so the database only returns rows that belong to the signed-in agency.",
  },
  {
    question: "Which currencies are supported?",
    answer:
      "A workspace works in INR or USD, set by the country you choose at sign-up. Prices in other currencies are converted with ECB reference rates and marked with ≈.",
  },
  {
    question: "Who on my team can do what?",
    answer:
      "The owner and admins invite teammates and manage the workspace. Agents search fares and hotels and handle enquiries. Each invitation is a one-time link that expires.",
  },
];

export function Faq() {
  return (
    <section id="faq" aria-labelledby="faq-title" className={cn(ANCHOR, "border-t border-line")}>
      <div className={cn(CONTAINER, SECTION_Y)}>
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-end">
          <div className="min-w-0">
            <Kicker>FAQ</Kicker>
            <h2 id="faq-title" className={SECTION_TITLE}>
              Questions agencies ask
            </h2>
          </div>
          <p className={cn(SECTION_LEAD, "lg:mt-0")}>Straight answers about data sources, pricing labels, the demo and access.</p>
        </div>
        <dl className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {FAQ.map(({ question, answer }) => (
            <div key={question} className="card p-5 lg:p-6">
              <dt className="font-display text-[15px] font-semibold leading-6 text-ink">{question}</dt>
              <dd className="mt-2 text-[13px] leading-5 text-dim">{answer}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

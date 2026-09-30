import { Gauge, SquareKanban, Leaf, Radar, ReceiptText, Tags, type LucideIcon } from "lucide-react";
import { Badge } from "../../ui/Badge";

type Feature = { icon: LucideIcon; title: string; body: string; comingSoon?: boolean };

const FEATURES: Feature[] = [
  {
    icon: Radar,
    title: "Every supplier in one search",
    body: "One search goes to every connected airline and hotel supplier. Each supplier's status and response time sit beside the results.",
  },
  {
    icon: Tags,
    title: "Prices labelled by source",
    body: "Every price is marked Live, Cached or Sandbox, and converted amounts carry ≈, so nobody quotes an estimate as a firm fare.",
  },
  {
    icon: Gauge,
    title: "Fare insight",
    body: "See whether a fare is good, typical or high for its route, per traveller, measured against the fares the platform has recorded.",
  },
  {
    icon: Leaf,
    title: "CO₂ per passenger",
    body: "Emissions estimates from Google's Travel Impact Model, shown per passenger next to the fare.",
  },
  {
    icon: SquareKanban,
    title: "One pipeline for enquiries",
    body: "Every enquiry moves from new through quoting to won or lost, with its client, route, dates and assignee attached.",
  },
  {
    icon: ReceiptText,
    title: "Quotes clients can open anywhere",
    body: "Bundle options, apply your markup and share a quote link your client can open on any device.",
    comingSoon: true,
  },
];

export function FeatureGrid() {
  return (
    <section id="features" aria-labelledby="features-title" className="scroll-mt-20">
      <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 lg:py-24">
        <div className="max-w-2xl">
          <h2 id="features-title" className="text-[28px] font-semibold leading-tight tracking-[-0.015em] text-ink sm:text-[32px]">
            Features
          </h2>
          <p className="mt-3 text-base leading-7 text-dim">
            Search, pricing context and the enquiry pipeline in one workspace, so agents stop switching between
            supplier tabs and spreadsheets.
          </p>
        </div>
        <ul className="mt-10 grid gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map(({ icon: Icon, title, body, comingSoon }) => (
            <li key={title} className="flex bg-bg">
              <article className="flex w-full flex-col p-6">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span
                    aria-hidden="true"
                    className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-line-strong bg-surface text-primary"
                  >
                    <Icon size={16} strokeWidth={1.75} />
                  </span>
                  {comingSoon && <Badge tone="info">Coming in the next release</Badge>}
                </div>
                <h3 className="mt-5 text-[15px] font-semibold text-ink">{title}</h3>
                <p className="mt-2 text-sm leading-6 text-dim">{body}</p>
              </article>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

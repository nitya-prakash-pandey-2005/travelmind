import { Gauge, Leaf, Radar, ReceiptText, ShieldCheck, Tags, type LucideIcon } from "lucide-react";
import { Badge } from "../../ui/Badge";

type Feature = { icon: LucideIcon; title: string; body: string; comingSoon?: boolean };

const FEATURES: Feature[] = [
  {
    icon: Radar,
    title: "Every source at once",
    body: "One search fans out to every connected airline and hotel supplier, with each supplier's status shown alongside the results.",
  },
  {
    icon: Tags,
    title: "Honest prices",
    body: "Every price is labelled Live, Cached or Sandbox, and converted amounts are marked ≈, so nobody quotes an estimate as fact.",
  },
  {
    icon: Gauge,
    title: "Fare intelligence",
    body: "See whether a fare is good, typical or high for its route, per traveller, measured against the fares we've recorded.",
  },
  {
    icon: Leaf,
    title: "CO₂ per passenger",
    body: "Emissions estimates for each passenger from Google's Travel Impact Model, right beside the fare.",
  },
  {
    icon: ReceiptText,
    title: "Quotes in minutes",
    body: "Bundle options, apply your markup and share a quote link your client can open on any device.",
    comingSoon: true,
  },
  {
    icon: ShieldCheck,
    title: "Built for teams",
    body: "Owner, admin and agent roles, each agency's data kept apart from every other, and an audit log of who did what.",
  },
];

export function FeatureGrid() {
  return (
    <section id="features" aria-label="Features" className="scroll-mt-20">
      <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:py-28">
        <div className="max-w-2xl">
          <h2 className="font-display text-3xl font-semibold leading-tight tracking-wide text-balance text-ink sm:text-4xl">
            One desk for every fare, room and quote
          </h2>
          <p className="mt-4 text-lg leading-relaxed text-dim">
            Search, pricing context and team workflow in one place, so agents stop juggling supplier tabs and
            spreadsheets.
          </p>
        </div>
        <ul className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map(({ icon: Icon, title, body, comingSoon }) => (
            <li key={title} className="flex">
              <article className="tm-glass tm-edge relative flex w-full flex-col rounded-md p-6">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <span
                    aria-hidden="true"
                    className="tm-tint inline-flex h-11 w-11 items-center justify-center rounded-md border text-primary"
                  >
                    <Icon size={20} strokeWidth={1.6} />
                  </span>
                  {comingSoon && <Badge tone="ai">Coming in the next release</Badge>}
                </div>
                <h3 className="mt-5 font-display text-lg font-semibold tracking-wide text-ink">{title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-dim">{body}</p>
              </article>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

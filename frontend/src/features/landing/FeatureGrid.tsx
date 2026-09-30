import { BedDouble, Command, Gauge, Leaf, Radar, ReceiptText, SquareKanban, Tags, type LucideIcon } from "lucide-react";
import { Badge } from "../../ui/Badge";
import { cn } from "../../ui/cn";
import { ANCHOR, CONTAINER, SECTION_LEAD, SECTION_TITLE, SECTION_Y } from "./layout";

type Feature = {
  icon: LucideIcon;
  title: string;
  body: string;
  comingSoon?: boolean;
};

const FEATURES: Feature[] = [
  {
    icon: Radar,
    title: "Every supplier in one search",
    body: "One search reaches every connected airline and hotel supplier, with each one's status and response time.",
  },
  {
    icon: Tags,
    title: "Prices labelled by source",
    body: "Live, Cached or Sandbox on every price, and ≈ on converted amounts, so estimates never pass as firm fares.",
  },
  {
    icon: Gauge,
    title: "Fare insight",
    body: "Whether a fare is good, typical or high for its route, per traveller, against the fares recorded for it.",
  },
  {
    icon: Leaf,
    title: "CO₂ per passenger",
    body: "Emissions estimates from Google's Travel Impact Model, shown next to each fare.",
  },
  {
    icon: BedDouble,
    title: "Hotel search",
    body: "Hotel rates by city and dates, with star rating, cancellation terms and the same source labels.",
  },
  {
    icon: SquareKanban,
    title: "One pipeline for enquiries",
    body: "Every enquiry moves from new through quoting to won or lost, with its client, route and assignee.",
  },
  {
    icon: Command,
    title: "Search from anywhere",
    body: "Press Ctrl K to open a client or enquiry, or jump to any page, without leaving the keyboard.",
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
    <section id="features" aria-labelledby="features-title" className={ANCHOR}>
      <div className={cn(CONTAINER, SECTION_Y)}>
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-end">
          <h2 id="features-title" className={SECTION_TITLE}>
            Features
          </h2>
          <p className={cn(SECTION_LEAD, "lg:mt-0")}>
            Search, pricing context and the enquiry pipeline in one workspace, so agents stop switching between supplier tabs and
            spreadsheets.
          </p>
        </div>
        <ul className="mt-10 grid gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map(({ icon: Icon, title, body, comingSoon }) => (
            <li key={title} className="flex bg-bg">
              <article className="flex w-full flex-col p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span
                    aria-hidden="true"
                    className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-line-strong bg-surface text-primary"
                  >
                    <Icon size={16} strokeWidth={1.75} />
                  </span>
                  {comingSoon && <Badge tone="info">Coming in the next release</Badge>}
                </div>
                <h3 className="mt-4 text-[15px] font-semibold text-ink">{title}</h3>
                <p className="mt-1.5 text-[13px] leading-5 text-dim">{body}</p>
              </article>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

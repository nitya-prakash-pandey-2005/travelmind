import { BedDouble, Command, Gauge, Leaf, Radar, ReceiptText, SquareKanban, Tags, type LucideIcon } from "lucide-react";
import { cn } from "../../ui/cn";
import { Kicker } from "./Kicker";
import { ANCHOR, CONTAINER, ICON_CHIP, SECTION_LEAD, SECTION_TITLE, SECTION_Y } from "./layout";

type Feature = {
  icon: LucideIcon;
  title: string;
  body: string;
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
    body: "Offer up to three fares, apply your markup and send a link your client can open on any device to accept or decline.",
  },
];

export function FeatureGrid() {
  return (
    <section id="features" aria-labelledby="features-title" className={ANCHOR}>
      <div className={cn(CONTAINER, SECTION_Y)}>
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-end">
          <div className="min-w-0">
            <Kicker>Capabilities</Kicker>
            <h2 id="features-title" className={SECTION_TITLE}>
              Features
            </h2>
          </div>
          <p className={cn(SECTION_LEAD, "lg:mt-0")}>
            Search, pricing context, the enquiry pipeline and client quotes in one workspace, so agents stop switching between
            supplier tabs and spreadsheets.
          </p>
        </div>
        <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map(({ icon: Icon, title, body }) => (
            <li key={title} className="flex">
              <article className="card flex w-full flex-col p-5">
                <span aria-hidden="true" className={ICON_CHIP}>
                  <Icon size={16} strokeWidth={1.75} />
                </span>
                <h3 className="mt-4 text-[15px] font-semibold leading-5 text-ink">{title}</h3>
                <p className="mt-1.5 text-[13px] leading-5 text-dim">{body}</p>
              </article>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

import { Check, LayoutDashboard, Plane, SquareKanban, Users, type LucideIcon } from "lucide-react";
import { useRef, useState, type ComponentType, type KeyboardEvent } from "react";
import { Badge } from "../../ui/Badge";
import { cn } from "../../ui/cn";
import { Illustration } from "./ConsolePreview";
import { CtaLink } from "./CtaLink";
import { ANCHOR, CONTAINER, SECTION_LEAD, SECTION_TITLE, SECTION_Y } from "./layout";
import { CommandCenterScreen, FareSearchScreen, PipelineScreen, TeamScreen } from "./TourScreens";

type Stop = {
  id: string;
  label: string;
  icon: LucideIcon;
  title: string;
  body: string;
  points: [string, string, string];
  /** Shown when part of the stop hasn't shipped yet. */
  upcoming?: string;
  screen: ComponentType;
  caption: string;
};

/** Each stop describes a screen that exists today (quotes excepted, and labelled so). */
const COMMAND_CENTER: Stop = {
  id: "command-center",
  label: "Command Center",
  icon: LayoutDashboard,
  title: "See the whole agency on one screen",
  body: "The Command Center opens on your key figures, the enquiry pipeline, live team activity and how each supplier is responding.",
  points: [
    "Seven key figures, each with its trend and change",
    "Team activity, refreshed every 20 seconds",
    "Supplier response times at p50 and p95",
  ],
  screen: CommandCenterScreen,
  caption: "Illustration of the Command Center with sample data. Names, figures and latencies are examples.",
};

const STOPS: Stop[] = [
  COMMAND_CENTER,
  {
    id: "fare-search",
    label: "Fare search",
    icon: Plane,
    title: "Compare every supplier's fares in one table",
    body: "One search goes to each connected supplier. Results land together, each with its source, emissions and a verdict on the price.",
    points: [
      "Live, Cached or Sandbox on every price",
      "Fare insight per traveller against the route's recorded fares",
      "CO₂ per passenger from Google's Travel Impact Model",
    ],
    screen: FareSearchScreen,
    caption: "Illustration of fare search with sample data. Airlines, times, prices and latencies are examples, not live results.",
  },
  {
    id: "pipeline",
    label: "Pipeline and quotes",
    icon: SquareKanban,
    title: "Move every enquiry from new to won",
    body: "Enquiries carry their client, route, dates and assignee, and move through new, quoting, quoted and won, with value at each stage.",
    points: [
      "Stage counts, conversion and quoted value",
      "Find any client or enquiry with Ctrl K",
      "Quotes with options, markup and a client link, in the next release",
    ],
    upcoming: "Quote building and client links.",
    screen: PipelineScreen,
    caption:
      "Illustration of the pipeline with sample data. Clients, routes and values are examples; the quote card shows the next release.",
  },
  {
    id: "team",
    label: "Team and roles",
    icon: Users,
    title: "Invite your team with the right access",
    body: "Owners and admins invite teammates with a one-time link and choose their role. Agents search and handle enquiries; they can't change the workspace.",
    points: [
      "Owner, admin and agent roles",
      "One-time invite links with an expiry",
      "Sign-ins, invitations and changes recorded in an audit log",
    ],
    screen: TeamScreen,
    caption: "Illustration of the Team page with sample data. Names and email addresses are examples.",
  },
];

const PANEL_ID = "product-tour";

const KEY_MOVES: Record<string, (current: number, last: number) => number> = {
  ArrowDown: (current, last) => (current === last ? 0 : current + 1),
  ArrowRight: (current, last) => (current === last ? 0 : current + 1),
  ArrowUp: (current, last) => (current === 0 ? last : current - 1),
  ArrowLeft: (current, last) => (current === 0 ? last : current - 1),
  Home: () => 0,
  End: (_, last) => last,
};

/**
 * The centrepiece: four real screens, one at a time. The stops are a vertical tab list beside the
 * screen (a scrolling row on small screens); arrows, Home and End move between them.
 */
export function ProductTour() {
  const [active, setActive] = useState(COMMAND_CENTER.id);
  const tabRefs = useRef(new Map<string, HTMLButtonElement>());
  const stop = STOPS.find((candidate) => candidate.id === active) ?? COMMAND_CENTER;
  const Screen = stop.screen;

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const move = KEY_MOVES[event.key];
    if (!move) return;
    event.preventDefault();
    const next = STOPS[move(STOPS.indexOf(stop), STOPS.length - 1)];
    if (!next) return;
    setActive(next.id);
    tabRefs.current.get(next.id)?.focus();
  }

  return (
    <section
      id="product"
      aria-labelledby="tour-title"
      className={cn(ANCHOR, "relative isolate overflow-hidden border-b border-line bg-surface")}
    >
      <div
        aria-hidden="true"
        className="tm-dot-grid absolute inset-x-0 top-0 -z-10 h-80 [mask-image:linear-gradient(to_bottom,#000,transparent)]"
      />
      <div className={cn(CONTAINER, SECTION_Y)}>
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-end">
          <h2 id="tour-title" className={SECTION_TITLE}>
            One workspace, from enquiry to quote
          </h2>
          <p className={cn(SECTION_LEAD, "lg:mt-0")}>
            The screens your agents use every day. Pick one to see what it shows and what it saves them.
          </p>
        </div>
        <div className="mt-10 grid gap-8 lg:grid-cols-[minmax(0,19rem)_minmax(0,1fr)] lg:gap-10 xl:grid-cols-[minmax(0,21rem)_minmax(0,1fr)]">
          <div className="flex min-w-0 flex-col gap-4">
            <div
              role="tablist"
              aria-label="Product tour"
              aria-orientation="vertical"
              onKeyDown={onKeyDown}
              className="flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible lg:pb-0"
            >
              {STOPS.map((candidate) => {
                const selected = candidate.id === stop.id;
                const Icon = candidate.icon;
                return (
                  <button
                    key={candidate.id}
                    ref={(node) => {
                      if (node) tabRefs.current.set(candidate.id, node);
                      else tabRefs.current.delete(candidate.id);
                    }}
                    type="button"
                    role="tab"
                    id={`${PANEL_ID}-${candidate.id}-tab`}
                    aria-selected={selected}
                    aria-controls={`${PANEL_ID}-${candidate.id}`}
                    aria-labelledby={`${PANEL_ID}-${candidate.id}-label`}
                    tabIndex={selected ? 0 : -1}
                    onClick={() => setActive(candidate.id)}
                    className={cn(
                      "relative flex shrink-0 flex-col items-start rounded-lg border px-4 py-3 text-left transition-colors duration-150 ease-tm lg:py-4",
                      selected ? "border-line-strong bg-bg" : "border-transparent hover:border-line hover:bg-hover",
                    )}
                  >
                    {selected && <span aria-hidden="true" className="absolute inset-y-3 left-0 w-0.5 rounded-full bg-primary" />}
                    <span
                      id={`${PANEL_ID}-${candidate.id}-label`}
                      className={cn("flex items-center gap-2 text-[13px] font-medium", selected ? "text-primary" : "text-dim")}
                    >
                      <Icon aria-hidden="true" size={14} strokeWidth={1.75} />
                      {candidate.label}
                    </span>
                    <span className="mt-1.5 hidden text-[15px] font-semibold leading-5 text-ink lg:block">{candidate.title}</span>
                    <span className={cn("mt-1 hidden text-[13px] leading-5 lg:block", selected ? "text-dim" : "text-faint")}>
                      {candidate.body}
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="hidden rounded-lg border border-dashed border-line-strong p-4 lg:block">
              <p className="text-[13px] leading-5 text-dim">Every screen here opens in the demo workspace, filled with sample data.</p>
              <CtaLink to="/demo" size="sm" variant="secondary" context=" to explore these screens" className="mt-3">
                Open demo workspace
              </CtaLink>
            </div>
          </div>
          <div
            role="tabpanel"
            id={`${PANEL_ID}-${stop.id}`}
            aria-labelledby={`${PANEL_ID}-${stop.id}-label`}
            tabIndex={0}
            className="min-w-0 rounded-sm"
          >
            <p className="text-lg font-semibold leading-6 tracking-[-0.01em] text-ink lg:hidden">{stop.title}</p>
            <p className="mt-1 text-sm leading-6 text-dim lg:hidden">{stop.body}</p>
            <ul className="mb-5 mt-4 grid gap-3 sm:grid-cols-3 lg:mt-0">
              {stop.points.map((point) => (
                <li key={point} className="flex gap-2.5 text-[13px] leading-5 text-ink">
                  <span
                    aria-hidden="true"
                    className="mt-px inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-line-strong text-primary"
                  >
                    <Check size={12} strokeWidth={2.25} />
                  </span>
                  {point}
                </li>
              ))}
            </ul>
            {stop.upcoming && (
              <p className="-mt-1 mb-5 flex flex-wrap items-center gap-2 text-[13px] text-dim">
                <Badge tone="info">Coming in the next release</Badge>
                {stop.upcoming}
              </p>
            )}
            <Illustration caption={stop.caption}>
              <Screen />
            </Illustration>
          </div>
        </div>
      </div>
    </section>
  );
}

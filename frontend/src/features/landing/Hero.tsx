import { Check } from "lucide-react";
import type { CSSProperties } from "react";
import { cn } from "../../ui/cn";
import {
  FareInsightCard,
  FareTable,
  Illustration,
  KpiStrip,
  MiniPanel,
  PipelineStages,
  PreviewWindow,
  ScreenHeader,
  SupplierStatusCard,
  TrendChart,
} from "./ConsolePreview";
import { CtaLink } from "./CtaLink";
import { CONTAINER } from "./layout";

const enter = (index: number) => ({ "--tm-enter-index": index }) as CSSProperties;

/** The title in two runs: the second, the promise, carries the kit gradient. One accessible name either way. */
const HERO_TITLE = ["Answer travel enquiries with", "fares you can explain"] as const;
const HERO_LEAD =
  "TravelMind searches your airline and hotel suppliers in one pass, shows whether each fare is good for its route, and turns each enquiry into a quote your client can open and accept. Every price says whether it is live, cached or sandbox.";

const PROOF = ["Source label on every price", "Fare insight per traveller", "Each agency's data kept apart"];

/** Cyan light behind the product, fading to nothing well before the edges. */
const GLOW: CSSProperties = {
  background: "radial-gradient(closest-side, color-mix(in oklab, var(--tm-primary) 15%, transparent), transparent)",
};

/**
 * The product as the hero's picture: a Command Center screen with the fare insight and supplier
 * status cards in a row beneath it (never on top of it). Past 1240 px it grows into the right
 * margin (capped), never off-screen.
 */
function HeroComposition() {
  return (
    <div className="tm-rise relative min-w-0 lg:mr-[calc(-1_*_clamp(0px,_(100vw_-_1240px)_/_2_-_24px,_280px))]" style={enter(2)}>
      <div aria-hidden="true" className="decor-gradient pointer-events-none absolute -inset-x-16 -inset-y-20 -z-10" style={GLOW} />
      <Illustration caption="Illustration with sample data: names, fares, latencies and figures are examples, not live results.">
        <div className="relative">
          <PreviewWindow active="Command Center" sidebar="xl" className="glow shadow-frame">
            <ScreenHeader
              crumb="Operate / Command Center"
              title="Command Center"
              meta="Tuesday 30 Sep · last 30 days"
              action="New enquiry"
            />
            <KpiStrip className="mt-3" />
            <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
              <MiniPanel title="Pipeline" aside={<span className="font-mono text-[10px] text-faint">24 open</span>}>
                <PipelineStages />
              </MiniPanel>
              <MiniPanel title="Enquiries" aside={<span className="font-mono text-[10px] text-ok">+18%</span>} className="max-sm:hidden">
                <TrendChart className="h-[5.5rem]" />
              </MiniPanel>
            </div>
            <div className="mt-3">
              <MiniPanel
                title="Fare search · DEL → DXB"
                aside={<span className="font-mono text-[10px] text-faint">4 results from 3 sources</span>}
              >
                <FareTable variant="medium" rows={3} />
              </MiniPanel>
            </div>
          </PreviewWindow>
          <div className="mt-3 grid gap-3 max-sm:hidden sm:grid-cols-2">
            <FareInsightCard className="card tight shadow-raise" />
            <SupplierStatusCard className="card tight shadow-raise" />
          </div>
        </div>
      </Illustration>
    </div>
  );
}

export function Hero() {
  return (
    <section aria-labelledby="landing-title" className="relative isolate overflow-hidden border-b border-line">
      <div
        className={cn(
          CONTAINER,
          "grid items-center gap-12 pb-16 pt-12 sm:pt-16 lg:grid-cols-[minmax(0,25rem)_minmax(0,1fr)] lg:gap-12 lg:pb-20 lg:pt-16 xl:grid-cols-[minmax(0,29rem)_minmax(0,1fr)] xl:gap-14",
        )}
      >
        <div className="min-w-0">
          <p
            className="tm-rise mb-5 inline-flex max-w-full items-center gap-2 rounded-full border border-line-soft bg-card-2 px-3 py-1 text-[13px] text-dim backdrop-blur-md"
            style={enter(0)}
          >
            <span aria-hidden="true" className="pulse-dot h-1.5 w-1.5 text-primary" />
            For travel management companies and agency teams
          </p>
          <h1
            id="landing-title"
            className="tm-rise max-w-[15ch] font-display text-[2.5rem] font-semibold leading-[1.05] tracking-[-0.03em] text-ink sm:text-[3.25rem] xl:text-[3.5rem]"
            style={enter(1)}
          >
            {HERO_TITLE[0]} <span className="grad-text">{HERO_TITLE[1]}</span>
          </h1>
          <p className="tm-rise mt-6 max-w-[34rem] text-base leading-7 text-dim sm:text-[17px]" style={enter(2)}>
            {HERO_LEAD}
          </p>
          <div className="tm-rise mt-8 flex flex-col gap-3 sm:flex-row sm:items-center" style={enter(3)}>
            <CtaLink to="/demo" size="lg">
              Open demo workspace
            </CtaLink>
            <CtaLink to="/signup" size="lg" variant="secondary">
              Create workspace
            </CtaLink>
          </div>
          <p className="tm-rise mt-4 text-[13px] text-faint" style={enter(4)}>
            The demo is a private workspace with sample data. No sign-up; deleted after 7 days.
          </p>
          <ul className="tm-rise mt-8 flex flex-col gap-2.5 border-t border-line pt-6" style={enter(5)}>
            {PROOF.map((point) => (
              <li key={point} className="flex items-center gap-2.5 text-sm text-dim">
                <span
                  aria-hidden="true"
                  className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-line-soft bg-card-2 bg-(image:--tm-grad-soft) text-primary"
                >
                  <Check size={12} strokeWidth={2.25} />
                </span>
                {point}
              </li>
            ))}
          </ul>
        </div>
        <HeroComposition />
      </div>
    </section>
  );
}

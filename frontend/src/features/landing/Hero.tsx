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

const HERO_TITLE = "Answer travel enquiries with fares you can explain";
const HERO_LEAD =
  "TravelMind searches your airline and hotel suppliers in one pass, shows whether each fare is good for its route, and keeps every enquiry in one pipeline. Every price says whether it is live, cached or sandbox.";

const PROOF = ["Source label on every price", "Fare insight per traveller", "Each agency's data kept apart"];

/** Cyan light behind the product, fading to nothing well before the edges. */
const GLOW: CSSProperties = {
  background: "radial-gradient(closest-side, color-mix(in oklab, var(--tm-primary) 15%, transparent), transparent)",
};

/** Floating cards sit above the window like popovers: the one elevation the design system allows. */
const FLOAT = "absolute z-10 w-64 shadow-[var(--tm-shadow-pop)]";

/**
 * The product as the hero's picture: a Command Center screen with the fare insight and supplier
 * status cards lifted off it. Past 1240 px it grows into the right margin (capped), never off-screen.
 */
function HeroComposition() {
  return (
    <div className="tm-rise relative min-w-0 lg:mr-[calc(-1_*_clamp(0px,_(100vw_-_1240px)_/_2_-_24px,_280px))]" style={enter(2)}>
      <div aria-hidden="true" className="pointer-events-none absolute -inset-x-16 -inset-y-20 -z-10" style={GLOW} />
      <Illustration caption="Illustration with sample data: names, fares, latencies and figures are examples, not live results.">
        <div className="relative sm:pb-8 sm:pl-6 xl:pr-8">
          <PreviewWindow active="Command Center" sidebar="xl" className="shadow-[0_32px_64px_-32px_rgb(0_0_0/0.55)]">
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
          <SupplierStatusCard className={cn(FLOAT, "right-0 top-[41%] max-xl:hidden")} />
          <FareInsightCard className={cn(FLOAT, "bottom-0 left-0 max-sm:hidden")} />
        </div>
      </Illustration>
    </div>
  );
}

export function Hero() {
  return (
    <section aria-labelledby="landing-title" className="relative isolate overflow-hidden border-b border-line">
      <div aria-hidden="true" className="tm-dot-grid tm-grid-fade absolute inset-0 -z-20" />
      <div
        className={cn(
          CONTAINER,
          "grid items-center gap-12 pb-16 pt-12 sm:pt-16 lg:grid-cols-[minmax(0,25rem)_minmax(0,1fr)] lg:gap-12 lg:pb-20 lg:pt-16 xl:grid-cols-[minmax(0,29rem)_minmax(0,1fr)] xl:gap-14",
        )}
      >
        <div className="min-w-0">
          <p
            className="tm-rise mb-5 inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 text-[13px] text-dim"
            style={enter(0)}
          >
            <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-primary" />
            For travel management companies and agency teams
          </p>
          <h1
            id="landing-title"
            className="tm-rise max-w-[15ch] text-[2.5rem] font-semibold leading-[1.05] tracking-[-0.025em] text-ink sm:text-[3.25rem] xl:text-[3.5rem]"
            style={enter(1)}
          >
            {HERO_TITLE}
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
                  className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-line-strong text-primary"
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

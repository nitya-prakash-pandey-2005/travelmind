import type { CSSProperties } from "react";
import { cn } from "../../ui/cn";
import { FareConsole, Illustration } from "./ConsolePreview";
import { CtaLink } from "./CtaLink";
import { Kicker } from "./Kicker";
import { CONTAINER, SECTION_TITLE } from "./layout";

const GLOW: CSSProperties = {
  background: "radial-gradient(closest-side, color-mix(in oklab, var(--tm-primary) 14%, transparent), transparent)",
};

/** The last call to action in a glowing glass card, beside a slice of the product so the page ends on the real thing. */
export function ClosingCall() {
  return (
    <section aria-labelledby="closing-title" className="relative isolate overflow-hidden border-t border-line">
      <div className={cn(CONTAINER, "py-16 lg:py-20")}>
        <div className="card glow relative isolate grid items-center gap-10 overflow-hidden p-4 sm:p-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-12 lg:p-12">
          <div
            aria-hidden="true"
            className="decor-gradient pointer-events-none absolute -right-40 top-1/2 -z-10 h-[36rem] w-[48rem] -translate-y-1/2"
            style={GLOW}
          />
          <div className="min-w-0">
            <Kicker>Demo workspace</Kicker>
            <h2 id="closing-title" className={SECTION_TITLE}>
              See it with sample data first
            </h2>
            <p className="mt-3 max-w-[34rem] text-base leading-7 text-dim">
              The demo opens a private workspace with sample clients and enquiries, priced by real sandbox searches and labelled as demo data
              throughout. It is deleted after 7 days.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
              <CtaLink to="/demo" size="lg" context=": no sign-up needed">
                Open demo workspace
              </CtaLink>
              <CtaLink to="/signup" size="lg" variant="secondary" context=" for your agency">
                Create workspace
              </CtaLink>
            </div>
          </div>
          <Illustration caption="Illustration with sample data, not live fares.">
            <FareConsole rows={4} className="shadow-frame" />
          </Illustration>
        </div>
      </div>
    </section>
  );
}

import type { ReactNode } from "react";
import { Badge } from "../../ui/Badge";
import { cn } from "../../ui/cn";
import { PROVENANCE } from "../../ui/provenance";
import { StatusPill } from "../../ui/StatusPill";
import { SAMPLE_FARES } from "./ConsolePreview";
import { Kicker } from "./Kicker";
import { ANCHOR, CONTAINER, SECTION_LEAD, SECTION_TITLE, SECTION_Y } from "./layout";

/** Small sample-data sketches, one per step. Decorative: the step text says the same thing. */
function EnquirySketch() {
  return (
    <div className="flex flex-col gap-1.5 text-[11px]">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-dim">E-0142</span>
        <StatusPill status="new" />
      </div>
      {[
        ["Client", "Mehta family"],
        ["Route", "DEL → LHR"],
        ["Dates", "12–19 Dec · 4 travellers"],
      ].map(([label, value]) => (
        <div key={label} className="grid grid-cols-[3.5rem_minmax(0,1fr)] gap-2 rounded-[8px] border border-line bg-card-2 px-2 py-1">
          <span className="text-faint">{label}</span>
          <span className="truncate text-ink">{value}</span>
        </div>
      ))}
    </div>
  );
}

/** The sketch is narrow: the first word of each provenance label. */
const SHORT_LABEL = {
  LIVE: "Live",
  CACHED: "Cached",
  SANDBOX: "Sandbox",
} as const;

function ResultsSketch() {
  return (
    <ul className="flex flex-col gap-1.5">
      {SAMPLE_FARES.slice(1).map((fare) => (
        <li
          key={fare.code}
          className="flex items-center justify-between gap-2 rounded-[8px] border border-line bg-card-2 px-2 py-1 text-[11px]"
        >
          <span className="w-6 font-mono text-dim">{fare.code}</span>
          <span className="flex-1 text-right font-mono tabular-nums text-ink">{fare.price}</span>
          <Badge tone={PROVENANCE[fare.provenance].tone} className="w-16 justify-center">
            {SHORT_LABEL[fare.provenance]}
          </Badge>
        </li>
      ))}
    </ul>
  );
}

function QuoteSketch() {
  return (
    <div className="flex flex-col gap-1.5 text-[11px]">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-dim">Q-0031</span>
        <StatusPill status="viewed" />
      </div>
      <div className="flex items-center justify-between rounded-[8px] border border-line bg-card-2 px-2 py-1">
        <span className="text-ink">3 flight options</span>
        <span className="text-faint">markup 8%</span>
      </div>
      <div className="flex items-center justify-between rounded-[8px] border border-dashed border-line-strong px-2 py-1">
        <span className="truncate text-dim">Link for the client</span>
        <span className="font-mono tabular-nums text-ink">₹3,53,800</span>
      </div>
    </div>
  );
}

type Step = { title: string; body: string; sketch: ReactNode };

const STEPS: Step[] = [
  {
    title: "Log the enquiry",
    body: "Record who is travelling, where and when. The enquiry joins your pipeline with an assignee, so nothing waits in an inbox.",
    sketch: <EnquirySketch />,
  },
  {
    title: "Search every supplier",
    body: "Search airlines and hotels in one pass and compare fares with their source, fare insight and emissions side by side.",
    sketch: <ResultsSketch />,
  },
  {
    title: "Send the quote",
    body: "Pick up to three fares, set your markup and send your client a link. They open it on any device and accept the option they want.",
    sketch: <QuoteSketch />,
  },
];

export function HowItWorks() {
  return (
    <section id="how-it-works" aria-labelledby="how-it-works-title" className={cn(ANCHOR, "border-y border-line")}>
      <div className={cn(CONTAINER, SECTION_Y)}>
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-end">
          <div className="min-w-0">
            <Kicker>Workflow</Kicker>
            <h2 id="how-it-works-title" className={SECTION_TITLE}>
              How it works
            </h2>
          </div>
          <p className={cn(SECTION_LEAD, "lg:mt-0")}>From the first message to a quote in the client's inbox, in three steps.</p>
        </div>
        <ol className="mt-10 grid gap-4 lg:grid-cols-3 lg:gap-0">
          {STEPS.map((step, index) => (
            <li key={step.title} className="relative flex flex-col lg:pr-8 lg:last:pr-0">
              {/* The connector: a hairline from this step's number to the next. */}
              <div className="flex items-center gap-3">
                <span
                  aria-hidden="true"
                  className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary bg-(image:--tm-grad) font-display text-[13px] font-bold text-primary-ink shadow-[0_6px_20px_-6px_var(--tm-glow)]"
                >
                  {index + 1}
                </span>
                {index < STEPS.length - 1 && <span aria-hidden="true" className="hidden h-px flex-1 bg-line-strong lg:block" />}
              </div>
              <div className="card mt-4 flex flex-1 flex-col p-5">
                <div className="flex-1">
                  <h3 className="text-[15px] font-semibold text-ink">{step.title}</h3>
                  <p className="mt-1.5 text-[13px] leading-5 text-dim">{step.body}</p>
                </div>
                <div aria-hidden="true" className="mt-5 select-none border-t border-line pt-4">
                  {step.sketch}
                </div>
              </div>
            </li>
          ))}
        </ol>
        <p className="mt-4 text-xs text-faint">Sketches use sample data.</p>
      </div>
    </section>
  );
}

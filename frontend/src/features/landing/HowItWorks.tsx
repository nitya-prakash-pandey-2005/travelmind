import { cn } from "../../ui/cn";

type Step = { title: string; body: string; note?: string };

const STEPS: Step[] = [
  {
    title: "Capture the enquiry",
    body: "Log who is travelling, where and when. Every enquiry joins your pipeline, so nothing slips.",
  },
  {
    title: "Scan every supplier",
    body: "Search airlines and hotels in one go and compare fares with their source, history and emissions side by side.",
  },
  {
    title: "Send the quote",
    body: "Pick the best options, set your markup and send your client a link to a polished quote.",
    note: "Quote sending arrives in the next release.",
  },
];

export function HowItWorks() {
  return (
    <section id="how-it-works" aria-labelledby="how-it-works-title" className="scroll-mt-20 border-t border-line bg-deck/40">
      <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:py-28">
        <h2 id="how-it-works-title" className="font-display text-3xl font-semibold tracking-wide text-ink sm:text-4xl">
          How it works
        </h2>
        <p className="mt-4 max-w-xl text-lg leading-relaxed text-dim">From first message to a quote in the client's inbox, on one screen.</p>
        <ol className="mt-14 grid gap-10 lg:grid-cols-3 lg:gap-8">
          {STEPS.map((step, index) => {
            const last = index === STEPS.length - 1;
            return (
              <li key={step.title} className="relative pl-16 lg:pl-0 lg:pt-16">
                {/* Connector to the next step: down the left edge on phones, across the top on wide screens. */}
                {!last && (
                  <span
                    aria-hidden="true"
                    className={cn(
                      "absolute bg-linear-to-b from-primary/70 to-line",
                      "left-5 top-12 -bottom-10 w-px",
                      "lg:left-12 lg:right-[-2rem] lg:top-5 lg:bottom-auto lg:h-px lg:w-auto lg:bg-linear-to-r",
                    )}
                  />
                )}
                <span
                  aria-hidden="true"
                  className="tm-tint absolute left-0 top-0 inline-flex h-10 w-10 items-center justify-center rounded-full border font-mono text-sm text-primary"
                >
                  {index + 1}
                </span>
                <h3 className="pt-1.5 font-display text-xl font-semibold tracking-wide text-ink lg:pt-0">{step.title}</h3>
                <p className="mt-3 max-w-sm leading-relaxed text-dim">{step.body}</p>
                {step.note && <p className="mt-3 text-sm text-ai">{step.note}</p>}
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}

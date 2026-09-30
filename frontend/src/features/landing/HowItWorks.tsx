type Step = { title: string; body: string; note?: string };

const STEPS: Step[] = [
  {
    title: "Log the enquiry",
    body: "Record who is travelling, where and when. The enquiry joins your pipeline with an assignee, so nothing waits in an inbox.",
  },
  {
    title: "Search every supplier",
    body: "Search airlines and hotels in one pass and compare fares with their source, fare insight and emissions side by side.",
  },
  {
    title: "Send the quote",
    body: "Pick the best options, set your markup and send your client a link to the quote.",
    note: "Quote sending arrives in the next release.",
  },
];

export function HowItWorks() {
  return (
    <section id="how-it-works" aria-labelledby="how-it-works-title" className="scroll-mt-20 border-t border-line bg-surface">
      <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 lg:py-24">
        <h2 id="how-it-works-title" className="text-[28px] font-semibold leading-tight tracking-[-0.015em] text-ink sm:text-[32px]">
          How it works
        </h2>
        <p className="mt-3 max-w-xl text-base leading-7 text-dim">From the first message to a quote in the client's inbox.</p>
        <ol className="mt-10 grid gap-px overflow-hidden rounded-lg border border-line bg-line lg:grid-cols-3">
          {STEPS.map((step, index) => (
            <li key={step.title} className="flex flex-col bg-surface p-6">
              <span aria-hidden="true" className="font-mono text-xs text-primary">
                Step {index + 1}
              </span>
              <h3 className="mt-3 text-[15px] font-semibold text-ink">{step.title}</h3>
              <p className="mt-2 max-w-sm text-sm leading-6 text-dim">{step.body}</p>
              {step.note && <p className="mt-3 text-[13px] text-info">{step.note}</p>}
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

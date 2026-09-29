import type { ReactNode } from "react";
import { Panel } from "../ui/Panel";

/** The "airlock": brand column plus a single form panel. */
export function AuthFrame({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <main className="tm-grid tm-scanlines grid min-h-dvh lg:grid-cols-[1.1fr_1fr]">
      <div className="relative hidden flex-col justify-between overflow-hidden border-r border-line p-10 lg:flex">
        <p className="font-display text-xl tracking-[0.4em] text-primary">TRAVELMIND</p>
        <svg viewBox="0 0 200 200" aria-hidden="true" className="tm-spin-slow mx-auto w-3/4 max-w-md opacity-80">
          <circle cx="100" cy="100" r="58" fill="none" stroke="var(--tm-primary)" strokeWidth="1.2" />
          <circle cx="100" cy="100" r="80" fill="none" stroke="var(--tm-line)" strokeDasharray="2 6" />
          <ellipse
            cx="100"
            cy="100"
            rx="92"
            ry="30"
            fill="none"
            stroke="var(--tm-ai)"
            strokeWidth="1"
            transform="rotate(-24 100 100)"
          />
          <circle cx="178" cy="68" r="4" fill="var(--tm-primary)" />
        </svg>
        <p className="max-w-sm font-display text-2xl leading-snug text-ink">
          Quote faster. Verify every fare. Keep your agency in orbit.
        </p>
      </div>
      <div className="flex items-center justify-center p-6">
        <Panel className="w-full max-w-md" eyebrow="Secure channel">
          <h1 className="font-display text-2xl tracking-wide text-ink">{title}</h1>
          <p className="mb-6 mt-1 text-sm text-dim">{subtitle}</p>
          {children}
        </Panel>
      </div>
    </main>
  );
}

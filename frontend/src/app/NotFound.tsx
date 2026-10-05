import { Link } from "@tanstack/react-router";
import { ArrowLeft, Compass } from "lucide-react";
import { buttonClasses } from "../ui/Button";

/** Unknown address: a kit glass card over the ambient glow and HUD grid. */
export function NotFound() {
  return (
    <main className="relative isolate grid min-h-dvh place-items-center bg-bg p-4">
      <div aria-hidden="true" className="tm-ambient -z-10" />
      <div className="card glow flex w-full max-w-sm flex-col items-center p-7 text-center">
        <span
          aria-hidden="true"
          className="mb-5 grid h-11 w-11 place-items-center rounded-[13px] border border-line-soft bg-card-2 bg-(image:--tm-grad-soft) text-primary"
        >
          <Compass size={19} strokeWidth={1.75} />
        </span>
        <p className="hud c-pink">Error 404</p>
        <h1 className="tm-page-title mt-1.5 font-display text-ink">Page not found</h1>
        <p className="mt-2 text-[13px] leading-5 text-dim">
          There's nothing at this address. Check the link, or head back to your workspace.
        </p>
        <Link to="/" className={buttonClasses({ variant: "primary", className: "mt-6" })}>
          <ArrowLeft size={15} aria-hidden="true" />
          Return to Command Center
        </Link>
      </div>
    </main>
  );
}

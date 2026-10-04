import { Link } from "@tanstack/react-router";
import { ArrowLeft, Compass } from "lucide-react";
import { buttonClasses } from "../ui/Button";

export function NotFound() {
  return (
    <main className="grid min-h-dvh place-items-center bg-bg p-4">
      <div className="flex w-full max-w-sm flex-col items-center text-center">
        <span
          aria-hidden="true"
          className="mb-5 grid h-10 w-10 place-items-center rounded-lg border border-line bg-surface text-dim"
        >
          <Compass size={18} strokeWidth={1.75} />
        </span>
        <p className="font-mono text-xs text-faint">404</p>
        <h1 className="tm-page-title mt-1 text-ink">Page not found</h1>
        <p className="mt-2 text-[13px] leading-5 text-dim">
          There's nothing at this address. Check the link, or head back to your workspace.
        </p>
        <Link to="/" className={buttonClasses({ variant: "secondary", className: "mt-6" })}>
          <ArrowLeft size={15} aria-hidden="true" />
          Return to Command Center
        </Link>
      </div>
    </main>
  );
}

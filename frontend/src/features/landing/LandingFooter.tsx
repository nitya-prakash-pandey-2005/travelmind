import { ThemeToggle } from "../../ui/ThemeToggle";
import { CtaLink } from "./CtaLink";

export function LandingFooter() {
  return (
    <footer className="border-t border-line">
      <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-10 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div className="flex flex-col gap-1">
          <p className="font-display text-sm tracking-[0.4em] text-primary">TRAVELMIND</p>
          <p className="text-sm text-dim">© 2026 TravelMind</p>
        </div>
        <nav aria-label="Footer" className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <CtaLink to="/login" variant="text" size="sm" className="px-0" context=" to your agency">
            Sign in
          </CtaLink>
          <CtaLink to="/signup" variant="text" size="sm" className="px-0" context=": create an agency account">
            Start free
          </CtaLink>
          <ThemeToggle />
        </nav>
      </div>
    </footer>
  );
}

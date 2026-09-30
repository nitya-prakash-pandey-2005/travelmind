import { ThemeToggle } from "../../ui/ThemeToggle";
import { CtaLink } from "./CtaLink";
import { Wordmark } from "./Wordmark";

const SECTION_LINK = "rounded-sm text-[13px] text-dim transition-colors duration-150 ease-tm hover:text-ink";

export function LandingFooter() {
  return (
    <footer className="border-t border-line">
      <div className="mx-auto flex max-w-6xl flex-col gap-8 px-4 py-10 sm:px-6 md:flex-row md:items-start md:justify-between">
        <div className="flex flex-col gap-2">
          <Wordmark />
          <p className="max-w-xs text-[13px] leading-5 text-dim">Fare search and enquiry pipeline for travel agencies.</p>
          <p className="text-xs text-faint">© 2026 TravelMind</p>
        </div>
        <nav aria-label="Footer" className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <a href="#features" className={SECTION_LINK}>
            Features
          </a>
          <a href="#how-it-works" className={SECTION_LINK}>
            How it works
          </a>
          <a href="#security" className={SECTION_LINK}>
            Security
          </a>
          <CtaLink to="/login" variant="text" context=" to your workspace">
            Sign in
          </CtaLink>
          <CtaLink to="/signup" variant="text" context=" for your agency">
            Create workspace
          </CtaLink>
          <ThemeToggle />
        </nav>
      </div>
    </footer>
  );
}

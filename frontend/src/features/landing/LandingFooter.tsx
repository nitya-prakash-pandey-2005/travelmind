import type { ReactNode } from "react";
import { cn } from "../../ui/cn";
import { ThemeToggle } from "../../ui/ThemeToggle";
import { CtaLink } from "./CtaLink";
import { CONTAINER } from "./layout";
import { Wordmark } from "./Wordmark";

const SECTION_LINK = "rounded-sm text-[13px] text-dim transition-colors duration-150 ease-tm hover:text-ink";

function Column({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-3">
      <h2 className="hud">{title}</h2>
      <ul className="flex flex-col gap-2.5">{children}</ul>
    </div>
  );
}

/** Only links that go somewhere real: in-page sections and the three ways in. */
export function LandingFooter() {
  return (
    <footer className="border-t border-line bg-chrome backdrop-blur-[20px]">
      <div className={cn(CONTAINER, "grid gap-10 py-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]")}>
        <div className="flex flex-col gap-3">
          <Wordmark />
          <p className="max-w-xs text-[13px] leading-5 text-dim">
            Fare search, fare insight and an enquiry pipeline for travel management companies and agencies.
          </p>
        </div>
        <nav aria-label="Footer" className="grid grid-cols-2 gap-10 sm:grid-cols-3">
          <Column title="Product">
            <li>
              <a href="#product" className={SECTION_LINK}>
                Product tour
              </a>
            </li>
            <li>
              <a href="#features" className={SECTION_LINK}>
                Features
              </a>
            </li>
            <li>
              <a href="#how-it-works" className={SECTION_LINK}>
                How it works
              </a>
            </li>
            <li>
              <a href="#data-sources" className={SECTION_LINK}>
                Data sources
              </a>
            </li>
          </Column>
          <Column title="Trust">
            <li>
              <a href="#security" className={SECTION_LINK}>
                Security
              </a>
            </li>
            <li>
              <a href="#faq" className={SECTION_LINK}>
                FAQ
              </a>
            </li>
          </Column>
          <Column title="Get started">
            <li>
              <CtaLink to="/demo" variant="text" context=" with sample data">
                Open demo workspace
              </CtaLink>
            </li>
            <li>
              <CtaLink to="/signup" variant="text" context=" for your agency">
                Create workspace
              </CtaLink>
            </li>
            <li>
              <CtaLink to="/login" variant="text" context=" to your workspace">
                Sign in
              </CtaLink>
            </li>
          </Column>
        </nav>
      </div>
      <div className="border-t border-line">
        <div className={cn(CONTAINER, "flex items-center justify-between gap-4 py-4")}>
          <p className="text-xs text-faint">© 2026 TravelMind</p>
          <ThemeToggle />
        </div>
      </div>
    </footer>
  );
}

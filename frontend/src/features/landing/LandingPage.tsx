import { Link } from "@tanstack/react-router";
import { useDocumentTitle } from "../../lib/useDocumentTitle";
import { cn } from "../../ui/cn";
import { ThemeSwitcher } from "../../theme/ThemeSwitcher";
import { ClosingCall } from "./ClosingCall";
import { CtaLink } from "./CtaLink";
import { Faq } from "./Faq";
import { FeatureGrid } from "./FeatureGrid";
import { Hero } from "./Hero";
import { HowItWorks } from "./HowItWorks";
import { IntegrationsStrip } from "./IntegrationsStrip";
import { CONTAINER } from "./layout";
import { LandingFooter } from "./LandingFooter";
import { PlatformFacts } from "./PlatformFacts";
import { ProductTour } from "./ProductTour";
import { TrustSection } from "./TrustSection";
import { usePageDescription } from "./usePageDescription";
import { Wordmark } from "./Wordmark";

const NAV_LINK = "hidden rounded-sm text-[13px] text-dim transition-colors duration-150 ease-tm hover:text-ink lg:inline";

const DESCRIPTION =
  "TravelMind is the operations console for travel agencies: search airline and hotel suppliers in one pass, see whether each fare is good for its route, and run every enquiry through one pipeline. Every price is labelled live, cached or sandbox.";

const SECTIONS = [
  { href: "#product", label: "Product" },
  { href: "#features", label: "Features" },
  { href: "#how-it-works", label: "How it works" },
  { href: "#security", label: "Security" },
  { href: "#faq", label: "FAQ" },
];

function TopNav() {
  return (
    <header className="tm-topbar sticky top-0 z-40 border-b border-line bg-bg/85 backdrop-blur-md">
      <nav aria-label="Main" className={cn(CONTAINER, "flex h-14 items-center gap-3 sm:gap-6")}>
        <Link to="/" className="mr-auto rounded-sm">
          <Wordmark />
        </Link>
        {SECTIONS.map((section) => (
          <a key={section.href} href={section.href} className={NAV_LINK}>
            {section.label}
          </a>
        ))}
        <span aria-hidden="true" className="hidden h-4 w-px bg-line lg:block" />
        <Link to="/login" className="rounded-sm text-[13px] text-dim transition-colors duration-150 ease-tm hover:text-ink">
          Sign in
        </Link>
        <CtaLink to="/signup" size="sm" context=" for your agency">
          Create workspace
        </CtaLink>
        <ThemeSwitcher hideNameBelow="lg" />
      </nav>
    </header>
  );
}

/** The public front door: the pitch with the product beside it, what it connects to, a tour, and two ways in. */
export function LandingPage() {
  useDocumentTitle("TravelMind — Operations console for travel agencies");
  usePageDescription(DESCRIPTION);
  return (
    <div className="tm-landing min-h-dvh overflow-x-clip bg-bg">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-3 focus:z-50 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-primary-ink"
      >
        Skip to content
      </a>
      <TopNav />
      <main id="main" tabIndex={-1} className="outline-none">
        <Hero />
        <IntegrationsStrip />
        <ProductTour />
        <PlatformFacts />
        <FeatureGrid />
        <HowItWorks />
        <TrustSection />
        <Faq />
        <ClosingCall />
      </main>
      <LandingFooter />
    </div>
  );
}

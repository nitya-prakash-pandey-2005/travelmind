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

/**
 * Fits from 320 px: below 440 px the gaps tighten and the call to action reads "Create" (its name stays "Create
 * workspace for your agency"); below 360 px it leaves the bar to the hero's, so the theme switcher stays on screen.
 */
function TopNav() {
  return (
    <header className="tm-topbar sticky top-0 z-40 border-b border-line bg-chrome backdrop-blur-[20px]">
      <nav aria-label="Main" className={cn(CONTAINER, "flex h-14 items-center gap-2 min-[440px]:gap-3 sm:gap-6")}>
        <Link to="/" className="mr-auto rounded-sm">
          <Wordmark />
        </Link>
        {SECTIONS.map((section) => (
          <a key={section.href} href={section.href} className={NAV_LINK}>
            {section.label}
          </a>
        ))}
        <span aria-hidden="true" className="hidden h-4 w-px bg-line lg:block" />
        <Link
          to="/login"
          className="shrink-0 whitespace-nowrap rounded-sm text-[13px] text-dim transition-colors duration-150 ease-tm hover:text-ink"
        >
          Sign in
        </Link>
        <CtaLink to="/signup" size="sm" context=" for your agency" className="max-[360px]:hidden">
          {/* One inline run, so the space survives in the label and in the accessible name. */}
          <span>
            Create <span className="max-[440px]:sr-only">workspace</span>
          </span>
        </CtaLink>
        <ThemeSwitcher hideNameBelow="lg" />
      </nav>
    </header>
  );
}

/**
 * The public front door: the pitch with the product beside it, what it connects to, a tour, and two ways in. The
 * kit's ambient glow and HUD grid sit behind the whole page, pinned to the window as it scrolls.
 */
export function LandingPage() {
  useDocumentTitle("TravelMind — Operations console for travel agencies");
  usePageDescription(DESCRIPTION);
  return (
    <div className="tm-landing relative isolate min-h-dvh overflow-x-clip bg-bg">
      <div aria-hidden="true" className="tm-ambient fixed -z-10" />
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

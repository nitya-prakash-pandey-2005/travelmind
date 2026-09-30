import { Link } from "@tanstack/react-router";
import { useDocumentTitle } from "../../lib/useDocumentTitle";
import { ThemeToggle } from "../../ui/ThemeToggle";
import { ConsolePreview } from "./ConsolePreview";
import { CtaLink } from "./CtaLink";
import { FeatureGrid } from "./FeatureGrid";
import { Hero } from "./Hero";
import { HowItWorks } from "./HowItWorks";
import { LandingFooter } from "./LandingFooter";
import { PlatformFacts } from "./PlatformFacts";
import { TrustSection } from "./TrustSection";
import { Wordmark } from "./Wordmark";

const CREATE_CONTEXT = " for your agency";
const NAV_LINK = "hidden rounded-sm text-[13px] text-dim transition-colors duration-150 ease-tm hover:text-ink md:inline";

function TopNav() {
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-bg/85 backdrop-blur-md">
      <nav aria-label="Main" className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4 sm:gap-6 sm:px-6">
        <Link to="/" className="mr-auto rounded-sm">
          <Wordmark />
        </Link>
        <a href="#features" className={NAV_LINK}>
          Features
        </a>
        <a href="#how-it-works" className={NAV_LINK}>
          How it works
        </a>
        <a href="#security" className={NAV_LINK}>
          Security
        </a>
        <Link to="/login" className="rounded-sm text-[13px] text-dim transition-colors duration-150 ease-tm hover:text-ink">
          Sign in
        </Link>
        <CtaLink to="/signup" size="sm" context={CREATE_CONTEXT}>
          Create workspace
        </CtaLink>
        <span className="hidden sm:inline-flex">
          <ThemeToggle />
        </span>
      </nav>
    </header>
  );
}

function ProductPreview() {
  return (
    <section aria-labelledby="preview-title" className="relative isolate">
      <div className="mx-auto max-w-6xl px-4 pt-20 sm:px-6 lg:pt-24">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-end">
          <h2 id="preview-title" className="max-w-lg text-[28px] font-semibold leading-tight tracking-[-0.015em] text-ink sm:text-[32px]">
            Search once, compare every supplier
          </h2>
          <p className="max-w-lg text-base leading-7 text-dim">
            Results from each connected supplier land in one table, with the source, the emissions and a verdict on the
            price beside every fare.
          </p>
        </div>
        <div className="mt-10">
          <ConsolePreview caption="Illustration of fare search with sample data. Airlines, times, prices and latencies are examples, not live results." />
        </div>
      </div>
    </section>
  );
}

function ClosingCall() {
  return (
    <section aria-labelledby="closing-title" className="border-t border-line">
      <div className="relative isolate mx-auto max-w-6xl overflow-hidden px-4 py-20 sm:px-6 lg:py-24">
        <div aria-hidden="true" className="tm-dot-grid tm-grid-fade absolute inset-0 -z-10" />
        <div className="flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-xl">
            <h2 id="closing-title" className="text-[28px] font-semibold leading-tight tracking-[-0.015em] text-ink sm:text-[32px]">
              See it with sample data first
            </h2>
            <p className="mt-3 text-base leading-7 text-dim">
              The demo opens a private workspace with sample clients and enquiries, priced by real sandbox searches and
              labelled as demo data throughout. It is deleted after 7 days.
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <CtaLink to="/demo" size="lg" context=": no sign-up needed">
              Open demo workspace
            </CtaLink>
            <CtaLink to="/signup" size="lg" variant="secondary" context={CREATE_CONTEXT}>
              Create workspace
            </CtaLink>
          </div>
        </div>
      </div>
    </section>
  );
}

/** The public front door: the pitch, live platform facts, the product, and two ways in (demo or sign-up). */
export function LandingPage() {
  useDocumentTitle("TravelMind — Operations console for travel agencies");
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
        <PlatformFacts />
        <ProductPreview />
        <FeatureGrid />
        <HowItWorks />
        <TrustSection />
        <ClosingCall />
      </main>
      <LandingFooter />
    </div>
  );
}

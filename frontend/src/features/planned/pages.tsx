import { FileText, LayoutDashboard, Plane, PlugZap, ReceiptText, SquareKanban, UserRound, Users } from "lucide-react";
import { PlannedPage, type RelatedPage } from "./PlannedPage";

/**
 * This release's new pages while their screens are finished. Each is swapped for its real screen in
 * the router (pipeline, enquiry, quotes, quote editor, clients, client, route intel, settings, and the
 * client's quote page).
 */

const COMMAND_CENTER: RelatedPage = {
  to: "/app",
  label: "Command Center",
  hint: "Stage counts, pipeline value and activity",
  icon: LayoutDashboard,
};
const FARE_SEARCH: RelatedPage = {
  to: "/app/fares",
  label: "Fare search",
  hint: "Search every connected airline supplier",
  icon: Plane,
};
const PIPELINE: RelatedPage = {
  to: "/app/pipeline",
  label: "Pipeline",
  hint: "Every enquiry by stage",
  icon: SquareKanban,
};
const QUOTES: RelatedPage = { to: "/app/quotes", label: "Quotes", hint: "Quotes built and sent", icon: FileText };
const CLIENTS: RelatedPage = {
  to: "/app/clients",
  label: "Clients",
  hint: "Travellers and companies you quote for",
  icon: UserRound,
};

export function PipelinePlaceholder() {
  return (
    <PlannedPage
      title="Pipeline"
      description="Every enquiry by stage, from new to won or lost."
      coming={[
        "A board with New, Quoting, Quoted, Won and Lost columns, each with its count and value",
        "Moves by drag and drop, or from the keyboard with each card's Move menu",
        "Filters by assignee, client or route, and a list view",
        "A recorded reason for every lost enquiry",
      ]}
      related={[COMMAND_CENTER, FARE_SEARCH]}
    />
  );
}

export function EnquiryPlaceholder() {
  return (
    <PlannedPage
      title="Enquiry"
      breadcrumb={[{ label: "Pipeline", to: "/app/pipeline" }, { label: "Enquiry" }]}
      description="One enquiry's trip, quotes and history."
      coming={[
        "Trip details — route, dates, travellers, cabin and budget — editable in place",
        "Fare search prefilled with the trip, and a new quote in one click",
        "Every quote for the enquiry with its status, value and versions",
        "A timeline of status changes, quotes and client views",
      ]}
      related={[PIPELINE, FARE_SEARCH]}
    />
  );
}

export function QuotesPlaceholder() {
  return (
    <PlannedPage
      title="Quotes"
      description="Every quote you've built or sent, with its status and value."
      coming={[
        "Each quote with its client, route, status, value and versions",
        "Filters for draft, sent, viewed, accepted, declined and expired quotes",
        "A builder that adds up to three live fares, applies your markup and saves priced versions",
        "A share link your client can open on any device to accept or decline",
      ]}
      related={[PIPELINE, FARE_SEARCH]}
    />
  );
}

export function QuotePlaceholder() {
  return (
    <PlannedPage
      title="Quote"
      breadcrumb={[{ label: "Quotes", to: "/app/quotes" }, { label: "Quote" }]}
      description="Build, price and send one quote."
      coming={[
        "Up to three live fares, with your markup for the whole quote or per option",
        "Versions priced by TravelMind, with the change from the previous version",
        "A share link and a ready-to-paste WhatsApp message for your client",
        "Accepted, declined or expired, set by hand when the client answers another way",
      ]}
      related={[QUOTES, PIPELINE]}
    />
  );
}

export function ClientsPlaceholder() {
  return (
    <PlannedPage
      title="Clients"
      description="The travellers and companies you quote for."
      coming={[
        "Search and tag filters across every client",
        "Contact details, home airport, tags and notes",
        "Each client's enquiries, quotes, won value and last and next trips",
        "New clients added from a form with inline checks",
      ]}
      related={[PIPELINE, QUOTES]}
    />
  );
}

export function ClientPlaceholder() {
  return (
    <PlannedPage
      title="Client"
      breadcrumb={[{ label: "Clients", to: "/app/clients" }, { label: "Client" }]}
      description="One client's details, trips and history."
      coming={[
        "Contact details, tags and notes, editable in place",
        "Enquiries and quotes for the client, with won value and last trip",
        "A new enquiry for the client in one click",
        "A timeline of everything that happened with the client",
      ]}
      related={[CLIENTS, PIPELINE]}
    />
  );
}

export function RouteIntelPlaceholder() {
  return (
    <PlannedPage
      title="Route intel"
      description="What a route has cost lately, from recorded fares and your own searches."
      coming={[
        "The daily median fare with its typical range over the last 60 days",
        "How fares change with the number of days before departure",
        "The carriers seen on the route and their median fares",
        "Your agency's recent searches of the route",
      ]}
      related={[
        { ...FARE_SEARCH, hint: "Every search adds to a route's fare history" },
        { ...COMMAND_CENTER, hint: "Market pulse for your busiest routes" },
      ]}
    />
  );
}

export function SettingsPlaceholder() {
  return (
    <PlannedPage
      title="Settings"
      description="Your agency's profile and branding."
      coming={[
        "Agency name and time zone",
        "Country and currency, shown for reference",
        "A brand colour, checked for contrast in both themes and used on your client quote pages",
      ]}
      related={[
        { to: "/app/team", label: "Team", hint: "Invite teammates and set their roles", icon: Users },
        { to: "/app/suppliers", label: "Suppliers", hint: "Airline and hotel supplier connections", icon: PlugZap },
      ]}
    />
  );
}

/** The client's page for a quote link: standalone, outside the app, with no session. */
export function PublicQuotePlaceholder() {
  return (
    <main className="grid min-h-dvh place-items-center bg-bg p-4">
      <div className="flex w-full max-w-sm flex-col items-center text-center">
        <span
          aria-hidden="true"
          className="mb-5 grid h-10 w-10 place-items-center rounded-lg border border-line bg-surface text-dim"
        >
          <ReceiptText size={18} strokeWidth={1.75} />
        </span>
        <h1 className="tm-page-title text-ink">Your travel quote</h1>
        <p className="mt-2 text-[13px] leading-5 text-dim">
          This link opens a quote from your travel agent. The quote page isn't available yet — please check back
          shortly, or ask your travel agent for the details.
        </p>
      </div>
    </main>
  );
}

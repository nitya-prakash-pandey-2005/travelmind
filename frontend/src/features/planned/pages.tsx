import { FileText, LayoutDashboard, Plane, PlugZap, SquareKanban, UserRound, Users } from "lucide-react";
import { PlannedPage, type RelatedPage } from "./PlannedPage";

/**
 * This release's new pages while their screens are finished. Each is swapped for its real screen in
 * the router (clients, client, route intel and settings).
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

import { LayoutDashboard, Plane, PlugZap, Users } from "lucide-react";
import { PlannedPage, type RelatedPage } from "./PlannedPage";

/**
 * This release's new pages while their screens are finished. Each is swapped for its real screen in
 * the router (route intel and settings).
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

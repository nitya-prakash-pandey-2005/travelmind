import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Compass, Route } from "lucide-react";
import { marketPulseQueryOptions, routeEnquiriesQueryOptions } from "../../api/dashboard";
import { Panel } from "../../ui/Panel";
import { Skeleton } from "../../ui/Skeleton";
import { POPULAR_ROUTES } from "../fares/popularRoutes";
import { money, plural, routeName } from "./routeFacts";

type Suggestion = {
  origin: string;
  destination: string;
  /** This week's median per traveller from the agency's own searches, in `currency`. */
  median?: { minor: number; currency: string };
  enquiries: number;
};

const key = (origin: string, destination: string) => `${origin}-${destination}`;
const MAX_SUGGESTIONS = 8;

/**
 * Routes the agency already works on: the ones it searched (Market pulse, with this week's median) and the
 * ones its enquiries ask for, merged by route. Both come from the Command Center's own queries.
 */
function useAgencyRoutes() {
  const pulse = useQuery(marketPulseQueryOptions);
  const enquiries = useQuery(routeEnquiriesQueryOptions);
  const routes = new Map<string, Suggestion>();
  for (const route of pulse.data?.routes ?? []) {
    routes.set(key(route.origin, route.destination), {
      origin: route.origin,
      destination: route.destination,
      median: { minor: route.current_minor, currency: pulse.data?.currency ?? "" },
      enquiries: 0,
    });
  }
  for (const enquiry of enquiries.data?.items ?? []) {
    if (!enquiry.origin || !enquiry.destination || enquiry.origin === enquiry.destination) continue;
    const id = key(enquiry.origin, enquiry.destination);
    const existing = routes.get(id) ?? { origin: enquiry.origin, destination: enquiry.destination, enquiries: 0 };
    routes.set(id, { ...existing, enquiries: existing.enquiries + 1 });
  }
  return {
    routes: [...routes.values()].slice(0, MAX_SUGGESTIONS),
    loading: pulse.isPending || enquiries.isPending,
  };
}

function detail(route: Suggestion): string {
  const parts: string[] = [];
  if (route.median) parts.push(`Searched · ${money(route.median.minor, route.median.currency)} this week`);
  if (route.enquiries > 0) parts.push(plural(route.enquiries, "enquiry", "enquiries"));
  return parts.join(" · ");
}

function RouteButton({ label, hint, onClick }: { label: string; hint: string; onClick: () => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className="group flex w-full items-center gap-3 rounded-[14px] border border-line bg-card-2 px-3 py-2.5 text-left transition-colors duration-150 ease-tm hover:border-line-strong hover:bg-hover"
      >
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="font-mono text-[13px] font-semibold text-ink">{label}</span>
          <span className="truncate text-xs text-dim">{hint}</span>
        </span>
        <ArrowRight size={14} aria-hidden="true" className="shrink-0 text-faint transition-colors duration-150 group-hover:text-primary" />
      </button>
    </li>
  );
}

/** One-click routes to look at: the agency's own, or busy real routes before it has any. */
export function RouteSuggestions({ onPick, exclude }: { onPick: (origin: string, destination: string) => void; exclude?: string }) {
  const { routes, loading } = useAgencyRoutes();
  const own = routes.filter((route) => key(route.origin, route.destination) !== exclude);
  return (
    <Panel
      title="Your routes"
      icon={Route}
      description={own.length > 0 || loading ? "Routes your agency searched or has enquiries for" : "Busy routes to start with"}
    >
      {loading ? (
        <Skeleton lines={4} />
      ) : own.length > 0 ? (
        <ul className="grid gap-2 sm:grid-cols-2">
          {own.map((route) => (
            <RouteButton
              key={key(route.origin, route.destination)}
              label={routeName(route.origin, route.destination)}
              hint={detail(route)}
              onClick={() => onPick(route.origin, route.destination)}
            />
          ))}
        </ul>
      ) : (
        <>
          <p className="mb-3 flex items-start gap-2 text-[13px] leading-5 text-dim">
            <Compass size={15} aria-hidden="true" className="mt-0.5 shrink-0 text-faint" />
            Routes you search and enquire about will be listed here.
          </p>
          <ul className="grid gap-2 sm:grid-cols-2">
            {POPULAR_ROUTES.slice(0, 6).map(({ origin, destination }) => (
              <RouteButton
                key={key(origin.iata_code, destination.iata_code)}
                label={routeName(origin.iata_code, destination.iata_code)}
                hint={`${origin.city} to ${destination.city}`}
                onClick={() => onPick(origin.iata_code, destination.iata_code)}
              />
            ))}
          </ul>
        </>
      )}
    </Panel>
  );
}

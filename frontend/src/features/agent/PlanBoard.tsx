import { Link } from "@tanstack/react-router";
import {
  BedDouble,
  CalendarDays,
  CircleAlert,
  CloudSun,
  FilePlus2,
  Inbox,
  Landmark,
  ListChecks,
  Map as MapIcon,
  Plane,
  Plus,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { useMemo, type ReactNode } from "react";
import type { AgentRunDetail, AgentTool, AgentTrip, PlanResult, ToolResultStep } from "../../api/agent";
import { isWorking } from "../../api/agent";
import type { Airport } from "../../api/types";
import { MiniRing } from "../../kit";
import { Badge, type BadgeTone } from "../../ui/Badge";
import { Button, buttonClasses } from "../../ui/Button";
import { cn } from "../../ui/cn";
import { Panel } from "../../ui/Panel";
import { GlobePanel } from "../globe/GlobePanel";
import type { GlobeArc } from "../globe/RouteGlobe";
import { useAirports } from "../globe/useAirports";
import { CABIN_LABEL, fareSearchFor, isVerified, longDate, routeText, travellersText, tripNights } from "./agentText";
import {
  BudgetPanel,
  DayTimeline,
  FareComparison,
  FlightOptionCard,
  HotelOptionCard,
  PlaceList,
  planDays,
  WeatherStrip,
} from "./PlanCards";
import { TOOL_ICON } from "./RunTrace";

export type BoardActions = {
  /** Ask the agent to create an enquiry or draft a quote for this trip (it then asks for approval). */
  onAsk: (action: "enquiry" | "quote") => void;
  asking: "enquiry" | "quote" | null;
  askError: string | null;
  /** Put a follow-up request in the composer (not sent). */
  onExtend: (prompt: string) => void;
  /** Why no new plan can start (no model configured); the actions are then disabled. */
  blockedReason: string | null;
};

/** "All prices verified against live results", or the warning when the guard fell back. */
export function VerificationBanner({ verified }: { verified: boolean }) {
  const Icon = verified ? ShieldCheck : ShieldAlert;
  return (
    <p
      data-verified={verified}
      className={cn(
        "tm-tint flex items-start gap-2 rounded-[14px] border px-3.5 py-2.5 text-[13px] font-medium leading-5",
        verified ? "text-ok" : "text-warn",
      )}
    >
      <Icon size={15} aria-hidden="true" className="mt-0.5 shrink-0" />
      {verified ? "All prices verified against live results" : "Some values couldn't be verified — showing results only"}
    </p>
  );
}

function Fact({ label, children, mono = false }: { label: string; children: ReactNode; mono?: boolean }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="hud">{label}</dt>
      <dd className={cn("min-w-0 truncate text-[13px] leading-5 text-ink", mono && "font-mono")}>{children}</dd>
    </div>
  );
}

function TripFacts({ trip }: { trip: AgentTrip }) {
  const nights = tripNights(trip);
  const flights = Boolean(trip.origin);
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
      {flights ? (
        <>
          <Fact label="From">
            <span className="font-mono font-semibold">{trip.origin}</span>
            {trip.origin_city && <span className="text-dim"> · {trip.origin_city}</span>}
          </Fact>
          <Fact label="To">
            <span className="font-mono font-semibold">{trip.destination}</span>
            {trip.destination_city && <span className="text-dim"> · {trip.destination_city}</span>}
          </Fact>
          <Fact label="Depart">{trip.depart_date ? longDate(trip.depart_date) : "—"}</Fact>
          <Fact label="Return">{trip.return_date ? longDate(trip.return_date) : "One way"}</Fact>
        </>
      ) : (
        <>
          <Fact label="Stay near">
            <span className="font-mono font-semibold">{trip.destination}</span>
            {trip.destination_city && <span className="text-dim"> · {trip.destination_city}</span>}
          </Fact>
          <Fact label="Check-in">{trip.check_in ? longDate(trip.check_in) : "—"}</Fact>
          <Fact label="Check-out">{trip.check_out ? longDate(trip.check_out) : "—"}</Fact>
          {trip.rooms !== undefined && <Fact label="Rooms">{trip.rooms}</Fact>}
        </>
      )}
      {nights !== null && <Fact label="Nights">{nights}</Fact>}
      <Fact label="Travellers">{travellersText(trip.adults, trip.children_ages ?? [])}</Fact>
      {trip.cabin && <Fact label="Cabin">{CABIN_LABEL[trip.cabin]}</Fact>}
    </dl>
  );
}

/** The trip: its route on the globe (once both airports are known) and its facts. */
function TripPanel({ trip }: { trip: AgentTrip }) {
  const codes = useMemo(() => (trip.origin ? [trip.origin, trip.destination] : []), [trip.origin, trip.destination]);
  const airports = useAirports(codes);
  const from: Airport | undefined = trip.origin ? airports.get(trip.origin) : undefined;
  const to: Airport | undefined = airports.get(trip.destination);
  const arcs = useMemo<GlobeArc[]>(() => (from && to ? [{ from, to, active: true }] : []), [from, to]);
  const description = routeText(trip) ?? undefined;
  if (arcs.length === 0) {
    return (
      <Panel title="Trip" icon={MapIcon} description={description}>
        <TripFacts trip={trip} />
      </Panel>
    );
  }
  return (
    <GlobePanel arcs={arcs} title="Trip" icon={MapIcon} description={description} compact>
      <div className="mt-4 border-t border-line pt-4">
        <TripFacts trip={trip} />
      </div>
    </GlobePanel>
  );
}

/** What the next request could add, for the parts this plan doesn't have. */
function ExtendPanel({ result, onExtend }: { result: PlanResult; onExtend: (prompt: string) => void }) {
  const trip = result.trip;
  if (!trip) return null;
  const city = trip.destination_city ?? trip.destination;
  const base = [
    trip.origin ? `${trip.origin} to ${trip.destination}` : `Near ${trip.destination}`,
    trip.depart_date ? `${longDate(trip.depart_date)}${trip.return_date ? ` to ${longDate(trip.return_date)}` : ""}` : null,
    `for ${travellersText(trip.adults, trip.children_ages ?? [])}`,
  ]
    .filter(Boolean)
    .join(", ");
  const ideas: { label: string; prompt: string }[] = [];
  if (result.hotels.length === 0) ideas.push({ label: "Add hotels", prompt: `${base}, with a mid-range hotel` });
  if (result.places.length === 0) ideas.push({ label: `Sights in ${city}`, prompt: `${base}. Suggest sights to see in ${city}` });
  if (!result.budget) ideas.push({ label: "Estimate the budget", prompt: `${base}, with a hotel and a budget estimate` });
  if (result.itinerary.length === 0) ideas.push({ label: "Build a day-by-day plan", prompt: `${base}. Build a day-by-day itinerary` });
  if (ideas.length === 0) return null;
  return (
    <Panel title="Extend this plan" icon={Sparkles} description="Starts a new request in the composer; nothing is sent until you choose">
      <ul className="flex flex-wrap gap-2">
        {ideas.map((idea) => (
          <li key={idea.label}>
            <button type="button" onClick={() => onExtend(idea.prompt)} className="chip min-h-9 text-ink">
              <Plus size={13} aria-hidden="true" className="text-primary" />
              {idea.label}
            </button>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function PlanHeader({ run, result, actions }: { run: AgentRunDetail; result: PlanResult; actions: BoardActions }) {
  const verified = isVerified(run.grounded, result);
  const fares = result.trip ? fareSearchFor(result.trip) : null;
  const busy = isWorking(run.status) || run.status === "waiting_for_user" || actions.blockedReason !== null;
  return (
    <Panel title="Plan" icon={ListChecks} description={result.trip ? (routeText(result.trip) ?? undefined) : "From this run's results"}>
      <div className="flex flex-col gap-3">
        <VerificationBanner verified={verified} />
        <p className="whitespace-pre-wrap text-[13px] leading-5 text-ink">{result.summary}</p>
        {result.next_steps.length > 0 && (
          <div>
            <p className="hud mb-1">Next steps</p>
            <ol className="flex list-decimal flex-col gap-0.5 pl-5 text-[13px] leading-5 text-dim">
              {result.next_steps.map((step, index) => (
                <li key={index}>{step}</li>
              ))}
            </ol>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
          <Button size="sm" onClick={() => actions.onAsk("enquiry")} loading={actions.asking === "enquiry"} disabled={busy || actions.asking !== null}>
            <Inbox size={14} aria-hidden="true" />
            Create enquiry
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => actions.onAsk("quote")}
            loading={actions.asking === "quote"}
            disabled={busy || actions.asking !== null}
          >
            <FilePlus2 size={14} aria-hidden="true" />
            Draft quote
          </Button>
          {fares && (
            <Link to="/app/fares" search={fares} className={buttonClasses({ variant: "ghost", size: "sm" })}>
              <Plane size={14} aria-hidden="true" />
              Open in Fare search
            </Link>
          )}
        </div>
        <p className="text-xs leading-4 text-dim">
          {actions.blockedReason ??
            "Each starts a new plan for this trip that asks to save it. Nothing is saved until you approve, and nothing is booked or paid for."}
        </p>
        {actions.askError && (
          <p role="alert" className="flex items-center gap-1.5 text-xs text-danger">
            <CircleAlert size={13} aria-hidden="true" className="shrink-0" />
            {actions.askError}
          </p>
        )}
      </div>
    </Panel>
  );
}

/** The plan built from a finished run's result. */
function ResultBoard({ run, result, actions }: { run: AgentRunDetail; result: PlanResult; actions: BoardActions }) {
  const travellers = result.trip ? result.trip.adults + (result.trip.children_ages?.length ?? 0) : 1;
  const { days, built, undated } = planDays(result);
  const placesAttribution = useMemo(() => {
    const step = [...run.steps].reverse().find((s): s is ToolResultStep => s.kind === "tool_result" && s.payload.tool === "find_places");
    const attribution = step?.payload.data?.attribution;
    return typeof attribution === "string" ? attribution : null;
  }, [run.steps]);
  return (
    <div className="flex flex-col gap-4">
      <PlanHeader run={run} result={result} actions={actions} />
      {result.trip && <TripPanel trip={result.trip} />}
      {result.flights.length > 0 && (
        <Panel title="Flights" icon={Plane} description={`${result.flights.length} option${result.flights.length === 1 ? "" : "s"} · totals for all travellers`}>
          <div className="flex flex-col gap-2.5">
            {result.flights.map((offer) => (
              <FlightOptionCard key={offer.offer_id} offer={offer} travellers={travellers} />
            ))}
          </div>
        </Panel>
      )}
      {result.hotels.length > 0 && (
        <Panel title="Hotels" icon={BedDouble} description={`${result.hotels.length} option${result.hotels.length === 1 ? "" : "s"} · totals for the stay`}>
          <div className="flex flex-col gap-2.5">
            {result.hotels.map((hotel) => (
              <HotelOptionCard key={hotel.hotel_id} hotel={hotel} />
            ))}
          </div>
        </Panel>
      )}
      {result.weather && (
        <Panel
          title="Weather"
          icon={CloudSun}
          description={result.weather.place.name}
          actions={<Badge tone="info">{result.weather.label === "forecast" ? "Forecast" : "Typical for these dates"}</Badge>}
        >
          <WeatherStrip weather={result.weather} />
        </Panel>
      )}
      {days.length > 0 && (
        <Panel
          title="Day by day"
          icon={CalendarDays}
          description={built ? "The itinerary this plan built" : "Each date with the flights and weather the results give for it"}
        >
          <DayTimeline days={days} undated={undated} />
        </Panel>
      )}
      {result.budget ? <BudgetPanel budget={result.budget} /> : result.flights.length > 1 ? <FareComparison flights={result.flights} /> : null}
      {result.places.length > 0 && (
        <Panel title="Places" icon={Landmark} description={`${result.places.length} to consider`}>
          <PlaceList places={result.places} attribution={placesAttribution} />
        </Panel>
      )}
      <ExtendPanel result={result} onExtend={actions.onExtend} />
    </div>
  );
}

const CHECKLIST: { tool: AgentTool; label: string }[] = [
  { tool: "lookup_airport", label: "Places and airports" },
  { tool: "search_flights", label: "Flights" },
  { tool: "search_hotels", label: "Hotels" },
  { tool: "weather_forecast", label: "Weather" },
  { tool: "find_places", label: "Sights and places" },
  { tool: "estimate_budget", label: "Budget" },
];

/** A section's state on the progress board, as a kit badge in its tone. */
function StateBadge({ tone, label, live = false }: { tone: BadgeTone; label: string; live?: boolean }) {
  return (
    <Badge tone={tone} className="px-2 font-mono text-[10.5px]">
      <span aria-hidden="true" className={cn("dot h-1.5! w-1.5!", live && "tm-live")} />
      {label}
    </Badge>
  );
}

/** Before a result exists: what the plan has gathered so far, section by section. */
function ProgressBoard({ run }: { run: AgentRunDetail }) {
  const working = isWorking(run.status);
  const open = working || run.status === "waiting_for_user";
  const latest = new Map<AgentTool, { summary: string; ok: boolean } | "running">();
  for (const step of run.steps) {
    if (step.kind === "tool_call" && !latest.has(step.payload.tool)) latest.set(step.payload.tool, "running");
    if (step.kind === "tool_result") latest.set(step.payload.tool, { summary: step.payload.summary, ok: step.payload.ok });
  }
  const guard = [...run.steps].reverse().find((s) => s.kind === "guard");
  const gathered = CHECKLIST.filter(({ tool }) => typeof latest.get(tool) === "object").length;
  const description =
    run.status === "waiting_for_user"
      ? "Waiting for your answer before it continues"
      : working
        ? "Filling in from live results as they arrive"
        : "This run ended without a plan";
  return (
    <Panel
      title="Plan"
      icon={ListChecks}
      description={description}
      busy={working}
      actions={
        <div role="img" aria-label={`${gathered} of ${CHECKLIST.length} sections gathered`}>
          <MiniRing value={gathered} max={CHECKLIST.length} size={44} color="var(--tm-primary)" label={`${gathered}/${CHECKLIST.length}`} />
        </div>
      }
    >
      <ul className="list">
        {CHECKLIST.map(({ tool, label }) => {
          const state = latest.get(tool);
          const Icon: LucideIcon = TOOL_ICON[tool];
          const running = state === "running" && working;
          const done = typeof state === "object";
          return (
            <li key={tool} className="li gap-3 py-2.5">
              <span aria-hidden="true" className="grid h-8 w-8 shrink-0 place-items-center rounded-[10px] bg-card-2 text-dim">
                <Icon size={15} strokeWidth={1.75} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-medium leading-5 text-ink">{label}</span>
                <span className={cn("block truncate text-xs leading-4", done && !state.ok ? "text-danger" : "text-dim")}>
                  {done ? state.summary : running ? "Searching…" : open ? "Not yet" : "Not part of this run"}
                </span>
              </span>
              {done ? (
                state.ok ? (
                  <StateBadge tone="ok" label="Done" />
                ) : (
                  <StateBadge tone="danger" label="Failed" />
                )
              ) : running ? (
                <StateBadge tone="primary" label="In progress" live />
              ) : (
                <StateBadge tone="neutral" label="Waiting" />
              )}
            </li>
          );
        })}
        <li className="li gap-3 py-2.5">
          <span aria-hidden="true" className="grid h-8 w-8 shrink-0 place-items-center rounded-[10px] bg-card-2 text-dim">
            <ShieldCheck size={15} strokeWidth={1.75} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[13px] font-medium leading-5 text-ink">Price check</span>
            <span className="block text-xs leading-4 text-dim">
              {guard && guard.kind === "guard"
                ? guard.payload.passed
                  ? "Checked against live results"
                  : "Some values couldn't be verified"
                : "Every price is checked against the results before the plan is shown"}
            </span>
          </span>
          {guard && guard.kind === "guard" ? (
            guard.payload.passed ? (
              <StateBadge tone="ok" label="Done" />
            ) : (
              <StateBadge tone="warn" label="Not verified" />
            )
          ) : (
            <StateBadge tone="neutral" label="Waiting" />
          )}
        </li>
      </ul>
    </Panel>
  );
}

/**
 * The plan board: the verification banner, the trip on the globe, flight and hotel options, weather, the
 * day-by-day plan, the budget, places, and the actions that turn it into an enquiry or quote. Before the run
 * has a result it shows what has been gathered so far.
 */
export function PlanBoard({ run, actions }: { run: AgentRunDetail; actions: BoardActions }) {
  return (
    <section aria-label="Plan board" className="flex min-w-0 flex-col gap-4">
      {run.result ? <ResultBoard run={run} result={run.result} actions={actions} /> : <ProgressBoard run={run} />}
    </section>
  );
}

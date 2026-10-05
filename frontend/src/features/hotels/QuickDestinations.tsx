import { MapPin } from "lucide-react";
import type { Airport } from "../../api/types";
import { cn } from "../../ui/cn";
import { Panel } from "../../ui/Panel";
import { POPULAR_DESTINATIONS } from "../fares/popularRoutes";
import { QuickGroup } from "../fares/QuickGroup";

/** Destinations shown in all: recent ones first, popular ones fill the rest. */
const SLOTS = 8;
const keyOf = (a: Airport) => a.iata_code;

function DestinationChip({ airport, active, onPick }: { airport: Airport; active: boolean; onPick: (a: Airport) => void }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label={`Near ${airport.iata_code}, ${airport.city ?? airport.name}`}
      onClick={() => onPick(airport)}
      className={cn(
        "flex w-full min-w-0 items-center gap-3 rounded-[14px] border px-3 py-2.5 text-left transition-colors duration-150 ease-tm",
        active ? "border-primary bg-[image:var(--grad-soft)]" : "border-line bg-card-2 hover:border-line-strong",
      )}
    >
      <span className="font-mono text-[13px] font-medium text-ink">{airport.iata_code}</span>
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-[13px] leading-5 text-ink">{airport.city ?? airport.name}</span>
        <span title={airport.country_name} className="truncate text-xs leading-4 text-dim">
          {airport.country_name}
        </span>
      </span>
    </button>
  );
}

/**
 * One-click destinations for hotel search: where this user's recent fare searches went, then busy real
 * destinations (labelled as suggestions) to fill the panel. Picking one fills Near; it doesn't search.
 */
export function QuickDestinations({
  recent,
  selected,
  onPick,
}: {
  recent: Airport[];
  selected: Airport | null;
  onPick: (airport: Airport) => void;
}) {
  const mine = recent.slice(0, SLOTS);
  const taken = new Set(mine.map(keyOf));
  const popular = POPULAR_DESTINATIONS.filter((a) => !taken.has(keyOf(a))).slice(0, SLOTS - mine.length);
  const chip = (a: Airport) => <DestinationChip airport={a} active={selected?.iata_code === a.iata_code} onPick={onPick} />;
  return (
    <Panel title="Quick destinations" icon={MapPin} description="Pick one to fill Near, then scan." className="h-full">
      <div className="flex flex-col gap-4">
        <QuickGroup title="From your recent fare searches" items={mine} keyOf={keyOf} render={chip} />
        <QuickGroup
          title="Popular destinations"
          note="Suggested, not from your searches"
          items={popular}
          keyOf={keyOf}
          render={chip}
        />
      </div>
    </Panel>
  );
}

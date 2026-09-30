import { useQuery } from "@tanstack/react-query";
import { connectedSuppliers, platformFactsQueryOptions } from "../../api/platform";
import { formatNumber } from "../../lib/format";
import { Skeleton } from "../../ui/Skeleton";

type Fact = { value: number; one: string; many: string };

const ITEM = "flex flex-col gap-2 py-6 sm:px-8 sm:py-2 sm:first:pl-0";

/** Live figures from the platform itself: nothing on this strip is written by hand. Hidden if unavailable. */
export function PlatformFacts() {
  const facts = useQuery(platformFactsQueryOptions);
  if (facts.isError) return null;

  const items: Fact[] | null = facts.data
    ? [
        { value: facts.data.airports, one: "airport indexed", many: "airports indexed" },
        { value: connectedSuppliers(facts.data), one: "supplier connected", many: "suppliers connected" },
        { value: facts.data.routes_with_history, one: "route with fare history", many: "routes with fare history" },
      ]
    : null;

  return (
    <section aria-label="Platform facts" aria-busy={items ? undefined : true} className="border-y border-line bg-deck/60">
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-10">
        {items ? (
          <ul className="grid divide-y divide-line sm:grid-cols-3 sm:divide-x sm:divide-y-0">
            {items.map((fact) => (
              <li key={fact.many} className={ITEM}>
                <span className="font-mono text-4xl font-medium tabular-nums tracking-tight text-ink sm:text-5xl">
                  {formatNumber(fact.value)}
                </span>
                <span className="text-sm text-dim">{fact.value === 1 ? fact.one : fact.many}</span>
              </li>
            ))}
          </ul>
        ) : (
          <div className="grid divide-y divide-line sm:grid-cols-3 sm:divide-x sm:divide-y-0">
            <span className="sr-only">Loading platform facts…</span>
            {[0, 1, 2].map((index) => (
              <div key={index} className={ITEM}>
                <Skeleton className="h-10 w-32 sm:h-12" />
                <Skeleton className="h-3.5 w-40" />
              </div>
            ))}
          </div>
        )}
        <p className="mt-4 text-xs text-dim sm:mt-8">Figures come straight from the platform and refresh every few minutes.</p>
      </div>
    </section>
  );
}

import { useQuery } from "@tanstack/react-query";
import { ApiError } from "../../api/client";
import { connectedSuppliers, platformApi, platformFactsQueryOptions } from "../../api/platform";
import { formatNumber } from "../../lib/format";
import { Skeleton } from "../../ui/Skeleton";

/** The strip waits this long for the platform before stepping aside; a marketing page never hangs on it. */
export const FACTS_DEADLINE_MS = 6_000;

type Fact = { value: number; one: string; many: string };

/** Asks for the facts, but gives up (and lets the strip hide) after FACTS_DEADLINE_MS. */
function factsWithinDeadline({ signal }: { signal: AbortSignal }) {
  const controller = new AbortController();
  const stop = () => controller.abort();
  signal.addEventListener("abort", stop, { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new ApiError(0, "Platform facts took too long."));
    }, FACTS_DEADLINE_MS);
  });
  return Promise.race([platformApi.facts(controller.signal), deadline]).finally(() => {
    clearTimeout(timer);
    signal.removeEventListener("abort", stop);
  });
}

const ITEM = "flex min-w-0 flex-col gap-1.5 py-5 sm:px-8 sm:py-1 sm:first:pl-0";

/** Live figures from the platform itself: nothing on this strip is written by hand. Hidden if unavailable. */
export function PlatformFacts() {
  const facts = useQuery({ ...platformFactsQueryOptions, queryFn: factsWithinDeadline, retry: false });
  if (facts.isError) return null;

  const items: Fact[] | null = facts.data
    ? [
        { value: facts.data.airports, one: "airport indexed", many: "airports indexed" },
        { value: connectedSuppliers(facts.data), one: "supplier connected", many: "suppliers connected" },
        { value: facts.data.routes_with_history, one: "route with fare history", many: "routes with fare history" },
      ]
    : null;

  return (
    <section aria-label="Platform facts" aria-busy={items ? undefined : true} className="border-b border-line bg-surface">
      <div className="mx-auto grid max-w-6xl gap-6 px-4 py-8 sm:px-6 lg:grid-cols-[14rem_minmax(0,1fr)] lg:items-center lg:gap-10">
        <div className="flex flex-col gap-1">
          <p className="flex items-center gap-2 text-[13px] font-medium text-ink">
            <span aria-hidden="true" className="tm-live h-1.5 w-1.5 rounded-full bg-ok text-ok" />
            Live from the platform
          </p>
          <p className="text-xs leading-5 text-dim">Counted by the running service, not written by hand. Refreshed every five minutes.</p>
        </div>
        {items ? (
          <ul className="grid divide-y divide-line sm:grid-cols-3 sm:divide-x sm:divide-y-0">
            {items.map((fact) => (
              <li key={fact.many} className={ITEM}>
                <span className="font-mono text-[28px] font-medium leading-[34px] tabular-nums tracking-tight text-ink">
                  {formatNumber(fact.value)}
                </span>
                <span className="text-[13px] text-dim">{fact.value === 1 ? fact.one : fact.many}</span>
              </li>
            ))}
          </ul>
        ) : (
          <div className="grid divide-y divide-line sm:grid-cols-3 sm:divide-x sm:divide-y-0">
            <span className="sr-only">Loading platform facts…</span>
            {[0, 1, 2].map((index) => (
              <div key={index} className={ITEM}>
                <Skeleton className="h-[34px] w-24" />
                <Skeleton className="h-3.5 w-36" />
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

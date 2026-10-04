import { useQuery } from "@tanstack/react-query";
import { CircleAlert, CornerDownLeft, Sparkle, SquarePen } from "lucide-react";
import { useId, useMemo, type KeyboardEvent, type RefObject } from "react";
import { MAX_AGENT_TEXT } from "../../api/agent";
import { marketPulseQueryOptions, routeEnquiriesQueryOptions } from "../../api/dashboard";
import { formatNumber } from "../../lib/format";
import { Button } from "../../ui/Button";
import { cn } from "../../ui/cn";
import { Panel } from "../../ui/Panel";
import { FIELD_CONTROL } from "../../ui/TextField";
import { suggestedPrompts, type Suggestion } from "./agentText";

/** The agency's routes (searched, then enquired about), as the route suggestions on Route intel read them. */
function useAgencyRoutes(): { origin: string; destination: string }[] {
  const pulse = useQuery(marketPulseQueryOptions);
  const enquiries = useQuery(routeEnquiriesQueryOptions);
  return useMemo(() => {
    const seen = new Map<string, { origin: string; destination: string }>();
    for (const route of pulse.data?.routes ?? []) seen.set(`${route.origin}-${route.destination}`, route);
    for (const enquiry of enquiries.data?.items ?? []) {
      if (!enquiry.origin || !enquiry.destination || enquiry.origin === enquiry.destination) continue;
      const key = `${enquiry.origin}-${enquiry.destination}`;
      if (!seen.has(key)) seen.set(key, { origin: enquiry.origin, destination: enquiry.destination });
    }
    return [...seen.values()];
  }, [pulse.data, enquiries.data]);
}

export function useSuggestions(): Suggestion[] {
  const routes = useAgencyRoutes();
  return useMemo(() => suggestedPrompts(routes), [routes]);
}

/**
 * The request box: up to 2,000 characters with a counter; Enter sends and Shift+Enter starts a new line.
 * Suggested requests from the agency's own routes fill it in one click.
 */
export function Composer({
  value,
  onChange,
  onSubmit,
  submitting,
  error,
  disabledReason,
  inputRef,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (prompt: string) => void;
  submitting: boolean;
  error: string | null;
  /** Set when no plan can start (no model configured). */
  disabledReason: string | null;
  inputRef: RefObject<HTMLTextAreaElement | null>;
}) {
  const suggestions = useSuggestions();
  const counterId = useId();
  const errorId = useId();
  const trimmed = value.trim();
  const over = value.length > MAX_AGENT_TEXT;
  const blocked = disabledReason !== null;
  const canSend = trimmed.length > 0 && !over && !submitting && !blocked;

  const send = () => {
    if (canSend) onSubmit(trimmed);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      send();
    }
  };

  return (
    <Panel title="New plan" icon={SquarePen} description="Describe the trip in plain words">
      <form
        className="flex flex-col gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          send();
        }}
      >
        <label htmlFor={`${counterId}-prompt`} className="sr-only">
          Trip request
        </label>
        <textarea
          id={`${counterId}-prompt`}
          ref={inputRef}
          rows={5}
          value={value}
          disabled={blocked}
          onChange={(event) => onChange(event.target.value.slice(0, MAX_AGENT_TEXT))}
          onKeyDown={onKeyDown}
          aria-describedby={[counterId, error ? errorId : null].filter(Boolean).join(" ")}
          aria-invalid={error ? true : undefined}
          placeholder="Mumbai to Dubai for 4 adults, 12 to 16 Dec, mid-range hotel"
          className={cn(FIELD_CONTROL, "h-auto min-h-28 resize-y py-2 leading-5", error ? "border-danger" : "border-line-strong")}
        />
        <div className="flex items-center justify-between gap-2 text-[11px] leading-4 text-faint">
          <span className="inline-flex min-w-0 items-center gap-1 max-sm:hidden">
            <CornerDownLeft size={11} aria-hidden="true" className="shrink-0" />
            <span className="truncate">Enter sends · Shift+Enter adds a line</span>
          </span>
          <span id={counterId} className={cn("tm-num ml-auto shrink-0 whitespace-nowrap", value.length >= MAX_AGENT_TEXT ? "text-warn" : undefined)}>
            {formatNumber(value.length)} / {formatNumber(MAX_AGENT_TEXT)}
          </span>
        </div>
        {error && (
          <p id={errorId} role="alert" className="flex items-start gap-1.5 text-xs leading-4 text-danger">
            <CircleAlert size={13} aria-hidden="true" className="mt-px shrink-0" />
            {error}
          </p>
        )}
        {blocked && <p className="text-xs leading-4 text-dim">{disabledReason}</p>}
        <Button type="submit" loading={submitting} disabled={!canSend} className="w-full">
          Plan trip
        </Button>
      </form>
      <div className="mt-4 border-t border-line pt-3">
        <p className="hud mb-1">Suggested</p>
        <ul className="list -mx-2">
          {suggestions.map((suggestion) => (
            <li key={suggestion.prompt}>
              <button
                type="button"
                disabled={blocked}
                onClick={() => {
                  onChange(suggestion.prompt);
                  inputRef.current?.focus();
                }}
                className="li group items-start gap-2.5 py-2.5 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Sparkle size={13} aria-hidden="true" className="mt-0.5 shrink-0 text-faint group-hover:text-primary" />
                <span className="min-w-0">
                  <span className="block font-mono text-xs font-semibold leading-4 text-ink">{suggestion.label}</span>
                  <span className="block text-xs leading-4 text-dim">{suggestion.prompt}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </Panel>
  );
}

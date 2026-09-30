import { MapPin } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { ApiError } from "../../api/client";
import type { Airport } from "../../api/types";
import { cn } from "../../ui/cn";
import { FIELD_CONTROL, FIELD_LABEL } from "../../ui/TextField";
import { MIN_QUERY_LENGTH, useAirportSearch } from "./useAirportSearch";

type AirportPickerProps = {
  label: string;
  value: Airport | null;
  onChange: (airport: Airport | null) => void;
  placeholder?: string;
};

/** "New Delhi, India": where the airport is, for the second line of an option. */
function place(airport: Airport): string {
  return [airport.city, airport.country_name].filter(Boolean).join(", ");
}

/** The IATA code set in mono on a quiet chip: the one thing an agent scans for. */
function Code({ code, className }: { code: string; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-6 min-w-11 shrink-0 items-center justify-center rounded-[4px] px-1.5",
        "font-mono text-[13px] font-semibold tracking-[0.04em]",
        className,
      )}
    >
      {code}
    </span>
  );
}

/**
 * Airport combobox: type a city, airport or code; arrow keys move, Enter picks, Escape closes. Once picked,
 * the field shows the code and city with a Change button, at the same height as the input it replaces.
 */
export function AirportPicker({ label, value, onChange, placeholder = "City, airport or code" }: AirportPickerProps) {
  const id = useId();
  const listId = `${id}-list`;
  const hintId = `${id}-hint`;
  const [term, setTerm] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const { results, enabled, isSearching, isStale, error } = useAirportSearch(term);
  const inputRef = useRef<HTMLInputElement>(null);
  const changeRef = useRef<HTMLButtonElement>(null);
  // Picking or pressing Change swaps the input and the button, so focus would fall to <body>.
  // Only the user's own action moves focus; a value set elsewhere (palette, recent route) must not.
  const pendingFocus = useRef<"change" | "input" | null>(null);
  useEffect(() => {
    if (pendingFocus.current === "change") changeRef.current?.focus();
    else if (pendingFocus.current === "input") inputRef.current?.focus();
    pendingFocus.current = null;
  });

  if (value) {
    return (
      <div className="flex min-w-0 flex-col gap-1.5">
        <p className={FIELD_LABEL}>{label}</p>
        <div
          title={`${value.iata_code} · ${value.name}${place(value) ? ` · ${place(value)}` : ""}`}
          className="flex h-9 min-w-0 items-center gap-2 rounded-md border border-line-strong bg-surface-2 pl-1.5 pr-1"
        >
          <Code code={value.iata_code} className="bg-selected text-primary" />
          <span className="min-w-0 flex-1 truncate text-sm">
            {value.city && <span className="text-ink">{value.city} </span>}
            <span className={value.city ? "text-faint" : "text-ink"}>{value.name}</span>
          </span>
          <button
            ref={changeRef}
            type="button"
            aria-label={`Change ${label}`}
            onClick={() => {
              pendingFocus.current = "input";
              onChange(null);
            }}
            className="h-7 shrink-0 rounded-[4px] px-2 text-xs font-medium text-dim transition-colors duration-150 ease-tm hover:bg-hover hover:text-ink"
          >
            Change
          </button>
        </div>
      </div>
    );
  }

  const choose = (airport: Airport) => {
    pendingFocus.current = "change";
    onChange(airport);
    setTerm("");
    setOpen(false);
  };
  const showList = open && enabled;
  // Results from an earlier term stay visible (dimmed) but cannot be picked until the live term's results arrive.
  const activeOption = showList && !isStale ? results[active] : undefined;
  const errorMessage =
    error && !isStale ? (error instanceof ApiError ? error.message : "Airport search failed.") : null;
  const trimmed = term.trim();
  const tooShort = open && trimmed.length > 0 && trimmed.length < MIN_QUERY_LENGTH;

  return (
    <div className="relative flex min-w-0 flex-col gap-1.5">
      <label htmlFor={id} className={FIELD_LABEL}>
        {label}
      </label>
      <div className="relative">
        <MapPin
          size={15}
          aria-hidden="true"
          className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-faint"
        />
        <input
          ref={inputRef}
          id={id}
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={activeOption ? `${id}-opt-${active}` : undefined}
          aria-describedby={tooShort ? hintId : undefined}
          autoComplete="off"
          spellCheck={false}
          placeholder={placeholder}
          value={term}
          className={cn(FIELD_CONTROL, "border-line-strong pl-8")}
          onChange={(event) => {
            setTerm(event.target.value);
            setOpen(true);
            setActive(0);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setOpen(true);
              setActive((i) => Math.min(i + 1, Math.max(results.length - 1, 0)));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setActive((i) => Math.max(i - 1, 0));
            } else if (event.key === "Enter" && activeOption) {
              event.preventDefault();
              choose(activeOption);
            } else if (event.key === "Escape") {
              setOpen(false);
            }
          }}
        />
      </div>
      {tooShort && (
        <p id={hintId} className="text-xs leading-4 text-dim">
          Type at least {MIN_QUERY_LENGTH} letters
        </p>
      )}
      {showList && (
        <ul
          id={listId}
          role="listbox"
          aria-label={`${label} suggestions`}
          className="tm-popover absolute left-0 top-full z-30 mt-1 max-h-80 w-full overflow-auto rounded-lg p-1"
        >
          {results.map((airport, index) => {
            const highlighted = !isStale && index === active;
            return (
              <li
                key={airport.iata_code}
                id={`${id}-opt-${index}`}
                role="option"
                aria-selected={highlighted}
                aria-disabled={isStale || undefined}
                className={cn(
                  "flex items-center gap-3 rounded-md px-2 py-1.5 text-[13px]",
                  isStale ? "cursor-wait opacity-50" : "cursor-pointer",
                  highlighted && "bg-selected",
                )}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActive(index)}
                onClick={() => {
                  if (!isStale) choose(airport);
                }}
              >
                <Code
                  code={airport.iata_code}
                  className={cn("border", highlighted ? "border-primary/40 text-primary" : "border-line text-ink")}
                />
                <span className="min-w-0 flex-1 leading-4">
                  <span className="block truncate text-ink">{airport.name}</span>
                  {place(airport) && <span className="mt-0.5 block truncate text-xs text-dim">{place(airport)}</span>}
                </span>
                <span aria-hidden="true" className="shrink-0 font-mono text-[11px] text-faint">
                  {airport.country_code}
                </span>
              </li>
            );
          })}
          {(isStale || (isSearching && results.length === 0)) && (
            <li role="presentation" className="px-2 py-2 text-[13px] text-dim">
              Searching…
            </li>
          )}
          {!isStale && !isSearching && !errorMessage && results.length === 0 && (
            <li role="presentation" className="px-2 py-2 text-[13px] text-dim">
              No airports match “{trimmed}”
            </li>
          )}
          {errorMessage && (
            <li role="presentation" className="px-2 py-2 text-[13px] text-danger">
              {errorMessage}
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

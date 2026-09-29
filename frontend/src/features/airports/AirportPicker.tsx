import { useEffect, useId, useRef, useState } from "react";
import { ApiError } from "../../api/client";
import type { Airport } from "../../api/types";
import { Button } from "../../ui/Button";
import { cn } from "../../ui/cn";
import { MIN_QUERY_LENGTH, useAirportSearch } from "./useAirportSearch";

type AirportPickerProps = {
  label: string;
  value: Airport | null;
  onChange: (airport: Airport | null) => void;
  placeholder?: string;
};

export function AirportPicker({ label, value, onChange, placeholder = "City, airport or code" }: AirportPickerProps) {
  const id = useId();
  const listId = `${id}-list`;
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
      <div className="flex items-center justify-between gap-3 rounded-sm border border-line bg-void/50 px-3 py-2">
        <div className="min-w-0">
          <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-dim">{label}</p>
          <p className="flex items-baseline gap-2">
            <span className="font-mono text-xl text-primary">{value.iata_code}</span>
            <span className="truncate text-sm text-ink">{value.name}</span>
          </p>
          <p className="truncate text-xs text-dim">{[value.city, value.country_name].filter(Boolean).join(", ")}</p>
        </div>
        <Button
          ref={changeRef}
          variant="ghost"
          size="sm"
          aria-label={`Change ${label}`}
          onClick={() => {
            pendingFocus.current = "input";
            onChange(null);
          }}
        >
          Change
        </Button>
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

  return (
    <div className="relative flex flex-col gap-1.5">
      <label htmlFor={id} className="font-mono text-[11px] uppercase tracking-[0.22em] text-dim">
        {label}
      </label>
      <input
        ref={inputRef}
        id={id}
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={activeOption ? `${id}-opt-${active}` : undefined}
        autoComplete="off"
        spellCheck={false}
        placeholder={placeholder}
        value={term}
        className="h-10 rounded-sm border border-line bg-void/60 px-3 text-ink outline-none transition placeholder:text-dim/60 focus:border-primary"
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
      {open && trimmed.length > 0 && trimmed.length < MIN_QUERY_LENGTH && (
        <p className="text-xs text-dim">Type at least {MIN_QUERY_LENGTH} letters</p>
      )}
      {showList && (
        <ul
          id={listId}
          role="listbox"
          aria-label={`${label} suggestions`}
          className="absolute left-0 right-0 top-full z-20 mt-1 max-h-72 overflow-auto rounded-sm border border-line bg-raised shadow-xl"
        >
          {results.map((airport, index) => (
            <li
              key={airport.iata_code}
              id={`${id}-opt-${index}`}
              role="option"
              aria-selected={!isStale && index === active}
              aria-disabled={isStale || undefined}
              className={cn(
                "flex items-baseline gap-3 px-3 py-2 text-sm",
                isStale ? "cursor-wait opacity-50" : "cursor-pointer",
                !isStale && index === active ? "bg-primary/15 text-ink" : "text-dim",
              )}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setActive(index)}
              onClick={() => {
                if (!isStale) choose(airport);
              }}
            >
              <span className="w-10 shrink-0 font-mono text-primary">{airport.iata_code}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-ink">{airport.name}</span>
                <span className="block truncate text-xs">
                  {[airport.city, airport.country_name].filter(Boolean).join(", ")}
                </span>
              </span>
            </li>
          ))}
          {(isStale || (isSearching && results.length === 0)) && (
            <li role="presentation" className="px-3 py-2 font-mono text-xs uppercase tracking-[0.2em] text-dim">
              Scanning…
            </li>
          )}
          {!isStale && !isSearching && !errorMessage && results.length === 0 && (
            <li role="presentation" className="px-3 py-2 text-sm text-dim">
              No airports match “{trimmed}”
            </li>
          )}
          {errorMessage && (
            <li role="presentation" className="px-3 py-2 text-sm text-danger">
              {errorMessage}
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

import { useId } from "react";
import { cn } from "./cn";

export type SegmentOption<T extends string> = { value: T; label: string };

type SegmentedControlProps<T extends string> = {
  options: ReadonlyArray<SegmentOption<T>>;
  value: T;
  onChange: (value: T) => void;
  /** Accessible name of the group, e.g. "Range". */
  label: string;
  className?: string;
};

/**
 * A compact single-choice switch (e.g. 7d / 30d / 90d). Built on native radios, so the group is one
 * Tab stop and arrow keys move the selection exactly as the platform does.
 */
export function SegmentedControl<T extends string>({ options, value, onChange, label, className }: SegmentedControlProps<T>) {
  const name = useId();
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn("inline-flex max-w-full rounded-md border border-line bg-deck/60 p-0.5", className)}
    >
      {options.map((option) => {
        const checked = option.value === value;
        return (
          <label
            key={option.value}
            className={cn(
              "relative inline-flex h-7 min-w-10 cursor-pointer items-center justify-center rounded-[5px] px-2.5",
              "font-mono text-xs tabular-nums transition-colors duration-200 ease-tm",
              "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-1 has-[:focus-visible]:outline-primary",
              checked ? "tm-tint border text-primary" : "border border-transparent text-dim hover:text-ink",
            )}
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={checked}
              onChange={() => onChange(option.value)}
              className="sr-only"
            />
            {option.label}
          </label>
        );
      })}
    </div>
  );
}

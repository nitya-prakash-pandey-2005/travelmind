import { useId } from "react";
import { cn } from "./cn";

export type SegmentOption<T extends string> = { value: T; label: string };

type SegmentedControlProps<T extends string> = {
  options: ReadonlyArray<SegmentOption<T>>;
  value: T;
  onChange: (value: T) => void;
  /** Accessible name of the group, e.g. "Range". */
  label: string;
  /** Show the current value but block changes (e.g. a setting another choice fixes). */
  disabled?: boolean;
  /** Id of text that explains the control, such as why it is disabled. */
  describedBy?: string;
  className?: string;
};

/**
 * A compact single-choice switch (e.g. 7d / 30d / 90d), drawn as the kit's `.seg`. Built on native radios, so the
 * group is one Tab stop and arrow keys move the selection exactly as the platform does.
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  label,
  disabled = false,
  describedBy,
  className,
}: SegmentedControlProps<T>) {
  const name = useId();
  return (
    <div
      role="radiogroup"
      aria-label={label}
      aria-describedby={describedBy}
      aria-disabled={disabled || undefined}
      className={cn(
        "seg h-9 flex-nowrap items-center gap-0.5 p-[3px]",
        disabled && "opacity-50",
        className,
      )}
    >
      {options.map((option) => {
        const checked = option.value === value;
        return (
          <label
            key={option.value}
            className={cn(
              "relative inline-flex h-full min-w-9 items-center justify-center rounded-[9px] px-3 py-0",
              disabled ? "cursor-not-allowed" : "cursor-pointer",
              "text-[13px] font-semibold tabular-nums transition-colors duration-150 ease-tm",
              "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-1 has-[:focus-visible]:outline-primary",
              checked ? "on text-ink" : cn("text-dim", !disabled && "hover:text-ink"),
            )}
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={checked}
              disabled={disabled}
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

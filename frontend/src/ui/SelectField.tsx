import { useId, type ComponentProps } from "react";
import { cn } from "./cn";

type SelectFieldProps = Omit<ComponentProps<"select">, "id"> & { label: string; hint?: string; error?: string };

export function SelectField({ label, hint, error, className, children, ...select }: SelectFieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const showHint = Boolean(hint) && !error;
  const describedBy = error ? errorId : showHint ? hintId : undefined;
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className="font-mono text-[11px] uppercase tracking-[0.22em] text-dim">
        {label}
      </label>
      <select
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={cn(
          "h-10 rounded-sm border bg-void/60 px-3 text-ink outline-none transition focus:border-primary",
          error ? "border-danger" : "border-line",
        )}
        {...select}
      >
        {children}
      </select>
      {showHint && (
        <p id={hintId} className="text-xs text-dim">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

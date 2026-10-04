import { ChevronDown } from "lucide-react";
import { useId, type ComponentProps } from "react";
import { cn } from "./cn";
import { FIELD_CONTROL, FIELD_LABEL, FieldMessage } from "./TextField";

type SelectFieldProps = Omit<ComponentProps<"select">, "id"> & { label: string; hint?: string; error?: string };

export function SelectField({ label, hint, error, className, children, ...select }: SelectFieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const showHint = Boolean(hint) && !error;
  const describedBy = error ? errorId : showHint ? hintId : undefined;
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <label htmlFor={id} className={FIELD_LABEL}>
        {label}
      </label>
      <div className="relative">
        <select
          id={id}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={cn(
            FIELD_CONTROL,
            "cursor-pointer appearance-none pr-9",
            error ? "border-danger hover:border-danger" : "border-line-strong",
          )}
          {...select}
        >
          {children}
        </select>
        <ChevronDown
          size={15}
          aria-hidden="true"
          className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-dim"
        />
      </div>
      {showHint && hint && <FieldMessage id={hintId}>{hint}</FieldMessage>}
      {error && (
        <FieldMessage id={errorId} error>
          {error}
        </FieldMessage>
      )}
    </div>
  );
}

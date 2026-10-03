import { CircleAlert } from "lucide-react";
import { useId, type ComponentProps } from "react";
import { cn } from "./cn";

type TextFieldProps = Omit<ComponentProps<"input">, "id"> & {
  label: string;
  error?: string;
  hint?: string;
};

/** Label above (13px medium), 36px input, helper text 12px, error 12px with an icon. */
export const FIELD_LABEL = "text-[13px] font-medium leading-5 text-ink";

export const FIELD_CONTROL = cn(
  "h-9 w-full min-w-0 rounded-md border bg-surface-2 px-3 text-sm text-ink",
  "transition-colors duration-150 ease-tm placeholder:text-faint",
  "hover:border-faint focus:border-primary",
  "disabled:cursor-not-allowed disabled:opacity-60",
);

export function FieldMessage({ id, error, children }: { id: string; error?: boolean; children: string }) {
  return error ? (
    <p id={id} className="flex items-start gap-1.5 text-xs leading-4 text-danger">
      <CircleAlert size={13} aria-hidden="true" className="mt-px shrink-0" />
      <span>{children}</span>
    </p>
  ) : (
    <p id={id} className="text-xs leading-4 text-dim">
      {children}
    </p>
  );
}

export function TextField({ label, error, hint, className, ...input }: TextFieldProps) {
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
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={cn(FIELD_CONTROL, error ? "border-danger hover:border-danger" : "border-line-strong")}
        {...input}
      />
      {showHint && hint && <FieldMessage id={hintId}>{hint}</FieldMessage>}
      {error && (
        <FieldMessage id={errorId} error>
          {error}
        </FieldMessage>
      )}
    </div>
  );
}

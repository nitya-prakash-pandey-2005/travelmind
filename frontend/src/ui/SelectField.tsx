import { useId, type ComponentProps } from "react";
import { cn } from "./cn";

type SelectFieldProps = Omit<ComponentProps<"select">, "id"> & { label: string };

export function SelectField({ label, className, children, ...select }: SelectFieldProps) {
  const id = useId();
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className="font-mono text-[11px] uppercase tracking-[0.22em] text-dim">
        {label}
      </label>
      <select
        id={id}
        className="h-10 rounded-sm border border-line bg-void/60 px-3 text-ink outline-none transition focus:border-primary"
        {...select}
      >
        {children}
      </select>
    </div>
  );
}

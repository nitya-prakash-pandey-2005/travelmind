/** A labelled instrument value. Renders <dt>/<dd>: always place Readouts inside a <dl>. */
export function Readout({ label, value, unit, hint }: { label: string; value: string; unit?: string; hint?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <dt className="tm-micro">{label}</dt>
      <dd className="font-mono text-xl font-medium tabular-nums tracking-tight text-ink">
        {value}
        {unit && <span className="ml-1 font-sans text-[13px] font-normal tracking-normal text-dim">{unit}</span>}
      </dd>
      {hint && <dd className="text-xs text-dim">{hint}</dd>}
    </div>
  );
}

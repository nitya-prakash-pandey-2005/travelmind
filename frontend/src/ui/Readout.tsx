/** A labelled instrument value. Renders <dt>/<dd>: always place Readouts inside a <dl>. */
export function Readout({ label, value, unit, hint }: { label: string; value: string; unit?: string; hint?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="font-mono text-[11px] uppercase tracking-[0.22em] text-dim">{label}</dt>
      <dd className="font-mono text-2xl text-ink">
        {value}
        {unit && <span className="ml-1 text-sm text-dim">{unit}</span>}
      </dd>
      {hint && <dd className="text-xs text-dim">{hint}</dd>}
    </div>
  );
}

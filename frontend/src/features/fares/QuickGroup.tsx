import { useId, type ReactNode } from "react";

/** A labelled grid of quick picks (routes or destinations); renders nothing when there are none. */
export function QuickGroup<T>({
  title,
  note,
  items,
  keyOf,
  render,
}: {
  title: string;
  /** Says where the items come from when it isn't the user's own history. */
  note?: string;
  items: T[];
  keyOf: (item: T) => string;
  render: (item: T) => ReactNode;
}) {
  const id = useId();
  if (items.length === 0) return null;
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <h3 id={id} className="tm-micro">
          {title}
        </h3>
        {note && <p className="text-[11px] leading-4 text-faint">{note}</p>}
      </div>
      <ul aria-labelledby={id} className="grid grid-cols-1 gap-2 min-[480px]:grid-cols-2 lg:grid-cols-4">
        {items.map((item) => (
          <li key={keyOf(item)} className="min-w-0">
            {render(item)}
          </li>
        ))}
      </ul>
    </section>
  );
}

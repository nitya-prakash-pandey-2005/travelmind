import { Children, type ReactNode } from "react";
import { cn } from "./cn";

/**
 * A line of facts divided by "·" that may wrap. The separator is drawn by CSS at the left of every item and
 * pushed outside the clipped box when that item starts a row, so a wrapped row never begins or ends with one
 * (see `.meta-line` in the kit's components.css). Falsy children are skipped.
 */
export function MetaLine({ children, className }: { children: ReactNode; className?: string }) {
  const items = Children.toArray(children).filter(Boolean);
  return (
    <span className={cn("meta-line", className)}>
      <span className="meta-line-list">
        {items.map((item, index) => (
          <span key={index} className="meta-line-item">
            {item}
          </span>
        ))}
      </span>
    </span>
  );
}

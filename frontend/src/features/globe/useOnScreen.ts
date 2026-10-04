import { useEffect, useState } from "react";

/** How far outside the viewport the globe keeps drawing, so it is already moving when scrolled back in. */
const MARGIN = "120px";

const tabVisible = () => typeof document === "undefined" || document.visibilityState !== "hidden";

/**
 * True while `node` is on (or just off) the screen and the tab is visible. The globe pauses its WebGL render loop
 * and its flying planes whenever this is false, so a map scrolled out of view or a background tab costs nothing.
 * Without IntersectionObserver (old browsers, tests) the element counts as on screen.
 */
export function useOnScreen(node: Element | null, rootMargin = MARGIN): boolean {
  const [intersecting, setIntersecting] = useState(true);
  const [visible, setVisible] = useState(tabVisible);

  useEffect(() => {
    if (!node || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        const latest = entries[entries.length - 1];
        if (latest) setIntersecting(latest.isIntersecting);
      },
      { rootMargin },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [node, rootMargin]);

  useEffect(() => {
    const update = () => setVisible(tabVisible());
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);

  return intersecting && visible;
}

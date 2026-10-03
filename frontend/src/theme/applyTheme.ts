import type { ThemeChoice } from "./types";

/**
 * Put a (coerced) choice on <html> as data attributes. The generated theme stylesheet keys every token block
 * off these, so this is all a switch needs: no inline colours, no stylesheet swapping.
 */
export function applyTheme(choice: ThemeChoice, root: HTMLElement = document.documentElement): void {
  root.setAttribute("data-theme", choice.theme);
  root.setAttribute("data-mode", choice.mode);
  root.setAttribute("data-contrast", choice.contrast ? "high" : "normal");
}

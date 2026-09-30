import { useEffect } from "react";

/** Sets the browser tab title while the page is shown, and puts the previous one back afterwards. */
export function useDocumentTitle(title: string) {
  useEffect(() => {
    const previous = document.title;
    document.title = title;
    return () => {
      document.title = previous;
    };
  }, [title]);
}

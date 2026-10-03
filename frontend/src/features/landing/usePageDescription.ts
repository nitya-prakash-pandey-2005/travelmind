import { useEffect } from "react";

/**
 * Sets the page's `<meta name="description">` while the page is shown and puts the previous one back afterwards.
 * index.html keeps a neutral description (link previews of a client's quote read it), so a page with its own
 * pitch for search engines sets it here.
 */
export function usePageDescription(content: string) {
  useEffect(() => {
    let meta = document.head.querySelector<HTMLMetaElement>('meta[name="description"]');
    const created = !meta;
    if (!meta) {
      meta = document.createElement("meta");
      meta.name = "description";
      document.head.append(meta);
    }
    const previous = meta.content;
    meta.content = content;
    return () => {
      if (created) meta.remove();
      else meta.content = previous;
    };
  }, [content]);
}

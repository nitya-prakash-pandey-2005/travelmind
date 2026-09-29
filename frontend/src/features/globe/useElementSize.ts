import { useCallback, useRef, useState } from "react";

export function useElementSize<T extends HTMLElement>(): [(node: T | null) => void, { width: number; height: number }] {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const observer = useRef<ResizeObserver | null>(null);
  const ref = useCallback((node: T | null) => {
    observer.current?.disconnect();
    observer.current = null;
    if (!node) return;
    const measure = () => setSize({ width: Math.floor(node.clientWidth), height: Math.floor(node.clientHeight) });
    measure();
    observer.current = new ResizeObserver(measure);
    observer.current.observe(node);
  }, []);
  return [ref, size];
}

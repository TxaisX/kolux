// The width of an element, kept up to date as the pane is resized (the history column hides below 640 px).
import { useEffect, useRef, useState, type RefObject } from "react";

/** The element's width in px, or null until it has been measured. */
export function useWidth<T extends HTMLElement>(): [RefObject<T | null>, number | null] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState<number | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(Math.round(el.getBoundingClientRect().width));
    if (typeof ResizeObserver === "undefined") return;
    const watch = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w !== undefined) setWidth(Math.round(w));
    });
    watch.observe(el);
    return () => watch.disconnect();
  }, []);
  return [ref, width];
}

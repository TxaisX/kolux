// STAT-052: hovering any element with `data-tip` explains it about 200 ms after the pointer
// settles on it; one tooltip for the whole window, so no surface needs its own. The text is the
// element's own `data-tip`; moving off, pressing or scrolling takes it away. T-739: a keyboard focus
// on such an element shows it at once and points the element's aria-describedby at it.
import { useEffect, useLayoutEffect, useRef, useState } from "react";

const DELAY_MS = 200;

export default function Tip() {
  const [tip, setTip] = useState<{ text: string; x: number; y: number } | null>(null);
  useEffect(() => {
    let timer = 0;
    const hide = () => {
      clearTimeout(timer);
      setTip(null);
    };
    // T-739: a keyboard focus (a click focuses too, so focus-visible only) shows the tip at once and
    // describes the element by it; focus moving to an element without a tip hides it. No element with
    // data-tip has its own aria-describedby, and one left pointing at a hidden tip is skipped by readers.
    const over = (e: Event) => {
      const f = e.target as HTMLElement | null;
      const key = e.type == "focusin";
      if (key && !f!.matches?.(":focus-visible")) return;
      const el = f?.closest?.("[data-tip]") as HTMLElement | null;
      clearTimeout(timer);
      if (!el?.dataset.tip) {
        setTip(null);
        return;
      }
      if (key) f!.setAttribute("aria-describedby", "kolux-tip");
      const text = el.dataset.tip;
      const r = el.getBoundingClientRect();
      timer = window.setTimeout(() => setTip({ text, x: r.left + r.width / 2, y: r.bottom + 6 }), key ? 0 : DELAY_MS);
    };
    document.addEventListener("mouseover", over);
    document.addEventListener("focusin", over);
    document.addEventListener("mousedown", hide, true);
    document.addEventListener("scroll", hide, true);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("mouseover", over);
      document.removeEventListener("focusin", over);
      document.removeEventListener("mousedown", hide, true);
      document.removeEventListener("scroll", hide, true);
    };
  }, []);
  // Centred under the element, but kept inside the window (a sidebar dot sits 24 px from the edge).
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !tip) return;
    const half = el.offsetWidth / 2;
    el.style.left = `${Math.min(Math.max(tip.x, half + 6), window.innerWidth - half - 6)}px`;
  }, [tip]);
  if (!tip) return null;
  return (
    <div ref={ref} id="kolux-tip" className="tip" role="tooltip" style={{ left: tip.x, top: tip.y }}>
      {tip.text}
    </div>
  );
}

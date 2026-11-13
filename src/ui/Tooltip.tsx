// A tooltip drawn as Kolux's .tip and placed by Base UI's Tooltip (it flips and shifts to stay in the window). It shows
// about 200 ms after the pointer settles on the element, as the window-wide tip does (chrome/Tip.tsx, STAT-052), at
// once on a keyboard focus (and then describes the element by it), and goes on leave, blur, a press, or Escape, which
// it only watches: a dialog's own Escape still closes the dialog. When it shows is decided here, so the element stays
// the page's own and Base UI is read only when a tip first shows (part.ts).
import { cloneElement, useEffect, useId, useRef, useState, type FocusEvent, type ReactElement, type ReactNode, type Ref } from "react";
import { useBase } from "./part";
import "./ui.css";

const DELAY_MS = 200;
type Handlers = { onPointerEnter?: (e: unknown) => void; onPointerLeave?: (e: unknown) => void; onPointerDown?: (e: unknown) => void; onFocus?: (e: FocusEvent<Element>) => void; onBlur?: (e: unknown) => void; ref?: Ref<Element> };

/** `children` is the one element the tip describes; it stays the page's own element (no wrapper). */
export function Tooltip({ tip, side = "bottom", children }: { tip: ReactNode; side?: "top" | "bottom" | "left" | "right"; children: ReactElement }) {
  const [shown, setShown] = useState(false);
  const anchor = useRef<Element | null>(null);
  const timer = useRef(0);
  const id = useId();
  const base = useBase(shown);
  useEffect(() => {
    if (!shown) return;
    const key = (e: KeyboardEvent) => e.key === "Escape" && setShown(false);
    window.addEventListener("keydown", key, true);
    window.addEventListener("scroll", hide, true);
    return () => {
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("scroll", hide, true);
    };
  }, [shown]);
  useEffect(() => () => clearTimeout(timer.current), []);
  function hide() {
    clearTimeout(timer.current);
    setShown(false);
  }
  const own = children.props as Handlers;
  const childRef = (children as unknown as { props: { ref?: Ref<Element> } }).props.ref;
  const chain =
    <E,>(mine: (e: E) => void, theirs?: (e: E) => void) =>
    (e: E) => {
      theirs?.(e);
      mine(e);
    };
  const trigger = cloneElement(children as ReactElement<Handlers & { "aria-describedby"?: string }>, {
    ref: (el: Element | null) => {
      anchor.current = el;
      if (typeof childRef === "function") childRef(el);
      else if (childRef) (childRef as { current: Element | null }).current = el;
    },
    onPointerEnter: chain(() => {
      clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setShown(true), DELAY_MS);
    }, own.onPointerEnter),
    onPointerLeave: chain(hide, own.onPointerLeave),
    onPointerDown: chain(hide, own.onPointerDown),
    onFocus: chain((e: FocusEvent<Element>) => e.currentTarget.matches?.(":focus-visible") && setShown(true), own.onFocus),
    onBlur: chain(hide, own.onBlur),
    "aria-describedby": shown ? id : undefined,
  });
  return (
    <>
      {trigger}
      {shown && base && (
        <base.TooltipBox anchor={anchor} id={id} side={side}>
          {tip}
        </base.TooltipBox>
      )}
    </>
  );
}

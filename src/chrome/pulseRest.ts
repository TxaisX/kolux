// DT-C239: an always-repeating "at work" pulse (the first-run wizard's dots, a tour's ring) holds still once
// nobody has touched the app for a while. A running CSS animation makes the web view draw a new frame on every
// screen refresh, even for three 8 px dots: measured on the idle app, the wizard's pulse alone kept the web
// view's GPU process at about 24 % of one core (0.2 % with it stopped). The pulse runs as before while the
// user moves the mouse, clicks, scrolls or types; after PULSE_REST_MS without input it finishes the cycle it
// is in (so it stops at full strength, not half faded) and rests until the next input.
// The timing is DT-C231's cursor rest (blinkRest), reused rather than built twice.
import { useEffect, useRef, useState, type RefObject } from "react";
import { blinkRest } from "../terminal/blinkRest";

/** DT-C239: how long a pulse keeps going with no input before it rests. */
export const PULSE_REST_MS = 10_000;
/** Input that wakes a resting pulse. Captured on the window, so input anywhere counts. */
export const WAKE_EVENTS = ["pointermove", "pointerdown", "keydown", "wheel"] as const;

type Input = Pick<Window, "addEventListener" | "removeEventListener">;
type Wait = (fn: () => void, ms: number) => () => void;

/** Drives one pulse: `set(true)` now and on input after a rest, `set(false)` once a rest is due and
 *  `cycleEnd` reports the running cycle finished. Returns the stop. */
export function pulseRest(
  set: (pulsing: boolean) => void,
  cycleEnd: (then: () => void) => () => void,
  { after = PULSE_REST_MS, input = window as Input, wait, now }: { after?: number; input?: Input; wait?: Wait; now?: () => number } = {},
): () => void {
  let cancelEnd: (() => void) | null = null;
  const rest = blinkRest(
    (on) => {
      cancelEnd?.();
      cancelEnd = null;
      if (on) set(true);
      else
        cancelEnd = cycleEnd(() => {
          cancelEnd = null;
          set(false);
        });
    },
    { after, ...(wait ? { wait } : {}), ...(now ? { now } : {}) },
  );
  const poke = () => rest.poke();
  for (const e of WAKE_EVENTS) input.addEventListener(e, poke, true);
  rest.want(true);
  return () => {
    rest.stop();
    cancelEnd?.();
    cancelEnd = null;
    for (const e of WAKE_EVENTS) input.removeEventListener(e, poke, true);
  };
}

/** Calls `then` when a CSS animation under `el` next ends a cycle (or at once when none runs, e.g. with
 *  reduced motion; `fallbackMs` later at most). Returns the cancel. */
export function nextCycleEnd(el: HTMLElement | null, then: () => void, fallbackMs = 2000): () => void {
  const running = el?.getAnimations?.({ subtree: true }).some((a) => a.playState === "running") ?? false;
  if (!el || !running) {
    then();
    return () => {};
  }
  let done = false;
  const fire = () => {
    if (done) return;
    done = true;
    cancel();
    then();
  };
  const timer = setTimeout(fire, fallbackMs);
  el.addEventListener("animationiteration", fire);
  const cancel = () => {
    clearTimeout(timer);
    el.removeEventListener("animationiteration", fire);
  };
  return () => {
    done = true;
    cancel();
  };
}

/** A pulse under the returned ref rests after PULSE_REST_MS with no input while `active`; returns
 *  whether it rests now. The caller turns the animation off with a class while resting. */
export function usePulseRest<T extends HTMLElement>(active: boolean): [boolean, RefObject<T | null>] {
  const ref = useRef<T | null>(null);
  const [pulsing, setPulsing] = useState(true);
  useEffect(() => {
    if (!active) return;
    return pulseRest(setPulsing, (then) => nextCycleEnd(ref.current, then));
  }, [active]);
  return [active && !pulsing, ref];
}

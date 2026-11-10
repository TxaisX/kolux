// A tour keeps its card and ring on its target. Doing that with an animation-frame loop that never stops makes the
// web view run a frame callback on every screen refresh for as long as the tour is open, even when nothing on
// the page moves. This loop measures every frame while something is changing, rests after IDLE_FRAMES frames
// with no change, and starts again on the things that can move a target: a window resize, a scroll, a
// layout change in the page (a mutation or a resize of the target), a transition ending, a key or pointer
// release, a drag, the window coming back from hidden. Same result on screen, no wasted frames in between.

/** Frames with nothing changed before the loop rests (about 0.5 s at 60 Hz: longer than the page's transitions). */
export const IDLE_FRAMES = 30;

type Raf = (cb: () => void) => number;
type Caf = (id: number) => void;

/** Calls `measure` each frame; it returns true while something is still changing (or must be looked at again
 *  next frame). After `idle` frames in a row of false the loop stops until `wake()`. `stop()` ends it for good. */
export function restingLoop(
  measure: () => boolean,
  { idle = IDLE_FRAMES, raf = (cb) => requestAnimationFrame(cb), caf = (id) => cancelAnimationFrame(id) }: { idle?: number; raf?: Raf; caf?: Caf } = {},
) {
  let frame = 0;
  let calm = 0;
  let ended = false;
  const frameFn = () => {
    frame = 0;
    if (ended) return;
    if (measure()) calm = 0;
    else calm++;
    if (ended) return; // measure may have ended the loop (a tour that moved on)
    if (calm < idle) frame = raf(frameFn);
  };
  return {
    /** Look now and keep looking until things are calm again. Cheap to call often: one frame is queued at most. */
    wake() {
      if (ended) return;
      calm = 0;
      if (!frame) frame = raf(frameFn);
    },
    stop() {
      ended = true;
      if (frame) caf(frame);
      frame = 0;
    },
    /** Whether a frame is queued (false while resting). */
    get running() {
      return frame !== 0;
    },
  };
}

type Target = Pick<EventTarget, "addEventListener" | "removeEventListener">;

/** Events on the window that can move a target; the loop wakes on each. Passive and captured, so scrolls inside
 *  any panel count too and none of them can hold up scrolling. */
export const WAKE_ON = ["resize", "scroll", "transitionend", "animationend", "pointerup", "keyup", "click", "focusin"] as const;

/** Wakes `wake` on everything in WAKE_ON, on a drag (a pointer move with a button held), on the page coming
 *  back from hidden, and on layout changes (`watch`: the nodes whose size or children are observed; changes
 *  inside `ignore` do not count, so the tour's own card and a busy terminal do not keep it awake). Returns the stop. */
export function wakeOnChange(
  wake: () => void,
  { win = window as Target, doc = document as Target & { hidden: boolean }, watch = [] as Element[], root = null as Element | null, ignore = ".tour, .tour-ring, .xterm" } = {},
): () => void {
  const opts = { capture: true, passive: true } as const;
  const on = () => wake();
  const drag = (e: Event) => {
    if ((e as PointerEvent).buttons) wake();
  };
  const visible = () => {
    if (!doc.hidden) wake();
  };
  for (const e of WAKE_ON) win.addEventListener(e, on, opts);
  win.addEventListener("pointermove", drag, opts);
  doc.addEventListener("visibilitychange", visible);
  const resize = typeof ResizeObserver === "function" ? new ResizeObserver(on) : null;
  for (const el of watch) resize?.observe(el);
  const mutate =
    root && typeof MutationObserver === "function"
      ? new MutationObserver((records) => {
          for (const r of records) {
            const t = r.target instanceof Element ? r.target : r.target.parentElement;
            if (!t?.closest(ignore)) return wake();
          }
        })
      : null;
  if (root) mutate?.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ["class", "style", "hidden", "open", "aria-expanded"] });
  return () => {
    for (const e of WAKE_ON) win.removeEventListener(e, on, opts);
    win.removeEventListener("pointermove", drag, opts);
    doc.removeEventListener("visibilitychange", visible);
    resize?.disconnect();
    mutate?.disconnect();
  };
}

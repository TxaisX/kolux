// DT-C231: a blinking cursor holds steady once the user has not typed in the pane for a while, the
// way the Windows caret stops blinking after five seconds. Each blink is a full redraw of the pane
// (the GPU path repaints its whole canvas), so a focused pane left blinking keeps the GPU busy with
// nothing on screen changing. Typing, a click in the pane or focusing it makes it blink again.

/** DT-C231: how long the cursor blinks with no input before it holds steady. */
export const BLINK_REST_MS = 5_000;

type Wait = (fn: () => void, ms: number) => () => void;
const realWait: Wait = (fn, ms) => {
  const t = setTimeout(fn, ms);
  return () => clearTimeout(t);
};

/** Drives one pane's cursor blink: `set` applies the blink actually wanted now. */
export function blinkRest(set: (blink: boolean) => void, { after = BLINK_REST_MS, wait = realWait, now = Date.now }: { after?: number; wait?: Wait; now?: () => number } = {}) {
  let wanted = false;
  let resting = false;
  let last = now();
  let cancel: (() => void) | null = null;
  const apply = () => set(wanted && !resting);
  const stop = () => {
    cancel?.();
    cancel = null;
  };
  // One timer per rest, not one per keystroke: when it fires early it waits out the rest of the gap.
  const due = () => {
    cancel = null;
    const left = last + after - now();
    if (left > 0) {
      cancel = wait(due, left);
      return;
    }
    resting = true;
    apply();
  };
  const arm = () => {
    if (!cancel && wanted && !resting) cancel = wait(due, after);
  };
  return {
    /** The user's cursor-blink setting; called again whenever the pane's options are re-read. */
    want(on: boolean) {
      wanted = on;
      if (on) arm();
      else stop();
      apply();
    },
    /** Input in the pane, a click or focus: the cursor blinks again, and rests `after` ms later. */
    poke() {
      last = now();
      if (resting) {
        resting = false;
        apply();
      }
      arm();
    },
    stop,
  };
}

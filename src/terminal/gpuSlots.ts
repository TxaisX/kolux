// LAG-08: which pane gives up a GPU slot when a shown pane needs one. The window has a small pool of
// WebGL contexts (gpuPool, twelve); a pane without a slot draws on the slow plain path. Pure: no
// clock, no timers and no renderer import, so the choice can be tested on its own; the renderer owns
// the pool and hands in the panes it knows about.

/** One pane of the pool, as the choice sees it: `hiddenSince === null` means the pane is on screen. */
export type SlotHolder = {
  /** The `now()` reading taken when the pane was hidden; null while it is on screen. */
  readonly hiddenSince: number | null;
  /** True while the pane draws on the GPU and a slot is counted for it. */
  holds(): boolean;
};

/**
 * The pane to take a GPU slot from: hidden (never a shown pane), holding a slot, hidden for at least
 * its own minimum time (`minHiddenMs`, inclusive), and hidden longest. A tie goes to the first such
 * pane in iteration order. Null when no pane qualifies, an empty pool included. Changes nothing and
 * calls nothing on the panes except `holds()` and the `minHiddenMs` callback.
 */
export function pickSlotVictim<T extends SlotHolder>(panes: Iterable<T>, now: number, minHiddenMs: (pane: T) => number): T | null {
  let victim: T | null = null;
  let longest = Infinity;
  for (const pane of panes) {
    const since = pane.hiddenSince;
    if (since === null || now - since < minHiddenMs(pane) || !pane.holds()) continue;
    if (since < longest) {
      longest = since;
      victim = pane;
    }
  }
  return victim;
}

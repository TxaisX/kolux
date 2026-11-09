// Renderer choice for a terminal pane (spec TERM-103): try the GPU path, keep working on the
// plain path if it fails to load or loses its context later. At most twelve panes hold a GPU
// context at a time, hidden tabs counted while they hold one; the rest draw plain until a slot frees
// up. A pane hidden for PARK_AFTER_MS gives its context back and takes one again when it is shown
// (DT-C229). Pure so it can be tested without a browser; the pane hands in the real addon factory.

export type RendererMode = "webgl" | "dom";

export type WebglLike = {
  dispose(): void;
  onContextLoss(listener: () => void): unknown;
  clearTextureAtlas?(): void;
};

export type RendererHost<A extends WebglLike> = {
  loadAddon(addon: A): void;
};

export type RendererChoice = {
  /** The path drawing now (a parked pane draws plain until it is woken). */
  readonly mode: RendererMode;
  /** Fires when a GPU pane has fallen back to the plain path after a context loss. */
  onFallback: (listener: (reason: string) => void) => void;
  /** Throw the glyph caches away (after a paste burst or a system resume); nothing on the plain path. */
  clearGlyphs(): void;
  /** DT-C229: give the GPU context and its pool slot back (a long-hidden pane); true if one was held. */
  park(): boolean;
  /** DT-C229: after park, take a GPU context again when the pool has room; the mode now in force. */
  wake(): RendererMode;
  dispose(): void;
};

export type GpuPool = { max: number; live: number };

/** The window's one pool of GPU contexts. Twelve covers a full 12-pane grid; Chromium allows about
 * sixteen per page, so a full grid still draws on the GPU. */
export const gpuPool: GpuPool = { max: 12, live: 0 };

/** Settings key: `false` draws every terminal plain; absent or `true` lets the GPU path be tried. */
export const GPU_FIELD = "terminalGpu";
export const gpuOn = (settings: Record<string, unknown>): boolean => settings[GPU_FIELD] !== false;

export function attachRenderer<A extends WebglLike>(host: RendererHost<A>, makeWebgl: () => A, preferGpu = true, pool: GpuPool = gpuPool): RendererChoice {
  const listeners: Array<(reason: string) => void> = [];
  const notify = (reason: string) => listeners.forEach((l) => l(reason));
  const onFallback = (l: (reason: string) => void) => {
    listeners.push(l);
  };

  let addon: A | undefined;
  let held = false;
  // The GPU path is out for good once WebGL refused to load or lost its context; a pool that was
  // full only means plain for now.
  let refused = !preferGpu;
  let parked = false;
  let gone = false;
  const release = () => {
    if (held) pool.live--;
    held = false;
  };
  const drop = () => {
    try {
      addon?.dispose();
    } catch {
      /* already broken */
    }
    addon = undefined;
    release();
  };
  const load = (): boolean => {
    if (refused || gone || pool.live >= pool.max) return false;
    let made: A | undefined;
    try {
      made = makeWebgl();
      made.onContextLoss(() => {
        if (addon !== made) return; // an addon already parked or replaced
        drop();
        refused = true;
        notify("context lost");
      });
      host.loadAddon(made);
    } catch {
      try {
        made?.dispose();
      } catch {
        /* already broken */
      }
      refused = true;
      return false;
    }
    addon = made;
    held = true;
    pool.live++;
    return true;
  };
  load();
  return {
    get mode(): RendererMode {
      return addon ? "webgl" : "dom";
    },
    onFallback,
    clearGlyphs() {
      addon?.clearTextureAtlas?.();
    },
    park() {
      if (!addon) return false;
      drop();
      parked = true;
      return true;
    },
    wake() {
      if (parked) {
        parked = false;
        load();
      }
      return addon ? "webgl" : "dom";
    },
    dispose() {
      gone = true;
      drop();
    },
  };
}

/** DT-C229: how long a pane stays hidden before its GPU context goes back to the pool. */
export const PARK_AFTER_MS = 30_000;

type PausedTerm = { _core?: { _renderService?: { _handleIntersectionChange?: (e: { isIntersecting: boolean; intersectionRatio: number }) => void } } };

/** xterm pauses drawing while its screen is out of view and resumes from an IntersectionObserver
 *  callback, which comes after the first frame the pane is visible in. A renderer swapped in on
 *  reveal would show that frame blank, so the pane resumes xterm itself (xterm 6's own resume
 *  handler, the same call the observer makes) before refreshing. Null when this xterm has no such
 *  handler: then panes are never parked, which keeps TERM-103's whole frame on reveal. */
export function resumeHook(term: unknown): (() => void) | null {
  const service = (term as PausedTerm)?._core?._renderService;
  const resume = service?._handleIntersectionChange;
  if (typeof resume !== "function") return null;
  return () => resume.call(service, { isIntersecting: true, intersectionRatio: 1 });
}

type Wait = (fn: () => void, ms: number) => () => void;
const realWait: Wait = (fn, ms) => {
  const t = setTimeout(fn, ms);
  return () => clearTimeout(t);
};

/** DT-C229: parks `choice` once the pane has been hidden for `after` ms; on show, a parked pane
 *  takes a GPU context again and `redraw` runs with the mode now in force, before the frame is
 *  drawn (the pane calls `shown` from a layout effect). */
export function parkWhenHidden(choice: Pick<RendererChoice, "park" | "wake">, redraw: (mode: RendererMode) => void, after = PARK_AFTER_MS, wait: Wait = realWait) {
  let cancel: (() => void) | null = null;
  let parked = false;
  const stopWaiting = () => {
    cancel?.();
    cancel = null;
  };
  return {
    get parked() {
      return parked;
    },
    hidden(on: boolean) {
      if (on) {
        cancel ??= wait(() => {
          cancel = null;
          parked = choice.park() || parked;
        }, after);
        return;
      }
      stopWaiting();
      if (!parked) return;
      parked = false;
      redraw(choice.wake());
    },
    stop: stopWaiting,
  };
}

/**
 * A system resume is not an event the page gets, so a heartbeat notices it: ticks normally come a
 * few seconds apart; one that arrives more than `gap` late means the machine slept. The pane calls
 * `tick` on an interval and `onResume` resets its glyph caches.
 */
export function watchResume(onResume: () => void, now: () => number = Date.now, gap = 30_000): { tick(): void } {
  let last = now();
  return {
    tick() {
      const t = now();
      if (t - last > gap) onResume();
      last = t;
    },
  };
}

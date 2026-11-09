// Renderer choice for a terminal pane (spec TERM-103): try the GPU path, keep working on the
// plain path if it fails to load or loses its context later. At most twelve panes hold a GPU
// context at a time, hidden tabs counted while they hold one; the rest draw plain until a slot frees
// up. A pane hidden for PARK_AFTER_MS gives its context back and takes one again when it is shown,
// evicting the pane hidden longest when the pool is full (DT-C229). Pure so it can be tested
// without a browser; the pane hands in the real addon factory.

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
  /** True while the pane draws plain only because the pool was full: it may still take a slot. */
  readonly waiting: boolean;
  /** Fires when a GPU pane has fallen back to the plain path after a context loss. */
  onFallback: (listener: (reason: string) => void) => void;
  /** Throw the glyph caches away (after a paste burst or a system resume); nothing on the plain path. */
  clearGlyphs(): void;
  /** DT-C229: give the GPU context and its pool slot back (a long-hidden pane); true if one was held.
   *  `quiet` keeps the freed slot from being offered to waiting panes (the caller takes it itself). */
  park(quiet?: boolean): boolean;
  /** DT-C229: after park, or while waiting for a slot, take a GPU context when the pool has room;
   *  the mode now in force. A pane whose WebGL was refused or lost stays plain. */
  wake(): RendererMode;
  dispose(): void;
};

export type GpuPool = { max: number; live: number };

/** The window's one pool of GPU contexts. Twelve covers a full 12-pane grid; Chromium allows about
 * sixteen per page, so a full grid still draws on the GPU. */
export const gpuPool: GpuPool = { max: 12, live: 0 };

/** DT-C229: who is told when a slot of a pool frees up (panes drawing plain only because it was full). */
const slotWatchers = new WeakMap<GpuPool, Set<() => void>>();
const watchersOf = (pool: GpuPool) => {
  let set = slotWatchers.get(pool);
  if (!set) slotWatchers.set(pool, (set = new Set()));
  return set;
};

/** Calls `fn` each time a slot of `pool` frees up, until the pool is full again; returns the stop. */
export function onSlotFree(pool: GpuPool, fn: () => void): () => void {
  const set = watchersOf(pool);
  set.add(fn);
  return () => void set.delete(fn);
}

const slotFreed = (pool: GpuPool) => {
  for (const fn of [...watchersOf(pool)]) {
    if (pool.live >= pool.max) return;
    fn();
  }
};

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
  // full only means plain for now (`waiting`).
  let refused = !preferGpu;
  let parked = false;
  let waiting = false;
  let gone = false;
  const release = (quiet: boolean) => {
    const had = held;
    if (held) pool.live--;
    held = false;
    if (had && !quiet) slotFreed(pool);
  };
  const drop = (quiet = false) => {
    const was = addon;
    addon = undefined;
    try {
      was?.dispose();
    } catch {
      /* already broken */
    }
    release(quiet);
  };
  const load = (): boolean => {
    if (refused || gone) return false;
    if (pool.live >= pool.max) {
      waiting = true;
      return false;
    }
    waiting = false;
    let made: A | undefined;
    try {
      made = makeWebgl();
      made.onContextLoss(() => {
        if (addon !== made) return; // an addon already parked or replaced
        refused = true;
        drop();
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
    get waiting() {
      return waiting && !refused && !gone && !addon;
    },
    onFallback,
    clearGlyphs() {
      addon?.clearTextureAtlas?.();
    },
    park(quiet = false) {
      if (!addon) return false;
      parked = true;
      drop(quiet);
      return true;
    },
    wake() {
      if (!addon && (parked || waiting)) {
        parked = false;
        load();
      }
      return addon ? "webgl" : "dom";
    },
    dispose() {
      gone = true;
      waiting = false;
      drop();
    },
  };
}

/** DT-C229: how long a pane stays hidden before its GPU context goes back to the pool. */
export const PARK_AFTER_MS = 30_000;

type RenderService = {
  _handleIntersectionChange?: (e: { isIntersecting: boolean; intersectionRatio: number }) => void;
  _renderDebouncer?: { _animationFrame?: number; _innerRefresh?: () => void };
};
type XtermInside = { _core?: { _renderService?: RenderService } };
const serviceOf = (term: unknown): RenderService | undefined => (term as XtermInside | null | undefined)?._core?._renderService;

/** xterm pauses drawing while its screen is out of view and resumes from an IntersectionObserver
 *  callback, which comes after the first frame the pane is visible in. A renderer swapped in on
 *  reveal would show that frame blank, so the pane resumes xterm itself (xterm 6's own resume
 *  handler, the same call the observer makes; it also measures a cell size never measured while
 *  the pane was mounted hidden). Null when this xterm has no such handler: then panes are never
 *  parked, which keeps TERM-103's whole frame on reveal. */
export function resumeHook(term: unknown): (() => void) | null {
  const service = serviceOf(term);
  const resume = service?._handleIntersectionChange;
  if (typeof resume !== "function") return null;
  return () => resume.call(service, { isIntersecting: true, intersectionRatio: 1 });
}

/** `term.refresh` only asks for the next animation frame. On reveal the pane draws the pending rows
 *  now instead (xterm 6's own debouncer step, its frame request cancelled), so the frame being
 *  painted already holds the whole screen. Null when this xterm has no such step: then panes are
 *  never parked. */
export function renderNowHook(term: unknown, cancel: (id: number) => void = (id) => globalThis.cancelAnimationFrame?.(id)): (() => void) | null {
  const debouncer = serviceOf(term)?._renderDebouncer;
  const inner = debouncer?._innerRefresh;
  if (!debouncer || typeof inner !== "function") return null;
  return () => {
    if (debouncer._animationFrame !== undefined) cancel(debouncer._animationFrame);
    inner.call(debouncer);
  };
}

type Wait = (fn: () => void, ms: number) => () => void;
const realWait: Wait = (fn, ms) => {
  const t = setTimeout(fn, ms);
  return () => clearTimeout(t);
};

export type ParkHooks = {
  /** Resume xterm's paused drawing (resumeHook); runs before a context is taken. */
  resume(): void;
  /** Repaint every row now with `mode` in force (refresh, then renderNowHook) and report the mode. */
  redraw(mode: RendererMode): void;
  /** The pane gave its context back: it draws plain now. */
  parked(): void;
};

type Parker = { hiddenSince: number | null; holds(): boolean; evict(): void };
const parkersOf = new WeakMap<GpuPool, Set<Parker>>();

/** DT-C229: parks `choice` once the pane has been hidden for `after` ms. On show, a parked pane, or
 *  one drawing plain only because the pool was full, takes a GPU context again, evicting the pane
 *  hidden longest when the pool is full, and repaints before the frame is drawn (the pane calls
 *  `hidden(false)` from a layout effect). A visible pane still waiting takes the next slot freed. */
export function parkWhenHidden(
  choice: Pick<RendererChoice, "park" | "wake" | "mode" | "waiting">,
  hooks: ParkHooks,
  { after = PARK_AFTER_MS, wait = realWait, pool = gpuPool, now = Date.now }: { after?: number; wait?: Wait; pool?: GpuPool; now?: () => number } = {},
) {
  let cancel: (() => void) | null = null;
  let parked = false;
  let hidden = false;
  let parkers = parkersOf.get(pool);
  if (!parkers) parkersOf.set(pool, (parkers = new Set()));
  const all = parkers;
  const stopWaiting = () => {
    cancel?.();
    cancel = null;
  };
  const park = (quiet: boolean) => {
    stopWaiting();
    if (!choice.park(quiet)) return;
    parked = true;
    hooks.parked();
  };
  const me: Parker = { hiddenSince: null, holds: () => choice.mode === "webgl", evict: () => park(true) };
  all.add(me);
  const take = () => {
    if (pool.live >= pool.max) {
      let victim: Parker | null = null;
      for (const p of all) {
        if (p === me || p.hiddenSince === null || !p.holds()) continue;
        if (victim === null || p.hiddenSince < (victim.hiddenSince as number)) victim = p;
      }
      victim?.evict();
    }
    hooks.resume();
    parked = false;
    hooks.redraw(choice.wake());
  };
  const stopSlots = onSlotFree(pool, () => {
    if (!hidden && choice.waiting) take();
  });
  return {
    get parked() {
      return parked;
    },
    hidden(on: boolean) {
      hidden = on;
      if (on) {
        me.hiddenSince ??= now();
        cancel ??= wait(() => {
          cancel = null;
          park(false);
        }, after);
        return;
      }
      me.hiddenSince = null;
      stopWaiting();
      if (parked || choice.waiting) take();
    },
    stop() {
      stopWaiting();
      stopSlots();
      all.delete(me);
    },
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

/** How often the window's one heartbeat ticks (watchResume reads a gap over 30 s as a sleep). */
export const HEARTBEAT_MS = 5000;

const heartTimers = { every: (fn: () => void, ms: number): unknown => setInterval(fn, ms), stop: (h: unknown) => clearInterval(h as ReturnType<typeof setInterval>) };
const heartbeats = new Map<object, { fns: Set<() => void>; handle: unknown }>();

/** One window-level heartbeat for every pane's resume watch, instead of an interval per pane; the
 *  timer runs only while a pane listens. Returns the leave. */
export function onHeartbeat(fn: () => void, timers: { every: (fn: () => void, ms: number) => unknown; stop: (h: unknown) => void } = heartTimers): () => void {
  let set = heartbeats.get(timers);
  if (!set) heartbeats.set(timers, (set = { fns: new Set(), handle: null }));
  const beat = set;
  beat.fns.add(fn);
  beat.handle ??= timers.every(() => beat.fns.forEach((f) => f()), HEARTBEAT_MS);
  return () => {
    beat.fns.delete(fn);
    if (beat.fns.size === 0 && beat.handle !== null) {
      timers.stop(beat.handle);
      beat.handle = null;
    }
  };
}

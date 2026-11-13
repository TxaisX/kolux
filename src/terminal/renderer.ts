// Renderer choice for a terminal pane (spec TERM-103): try the GPU path, keep working on the
// plain path if it fails to load or loses its context later. At most twelve panes hold a GPU
// context at a time, hidden tabs counted while they hold one; the rest draw plain until a slot frees
// up. A pane hidden for PARK_AFTER_MS gives its context back and takes one again when it is shown,
// evicting a pane hidden at least that long when the pool is full (DT-C229). Pure so it can be tested
// without a browser; the pane hands in the real addon factory.

export type RendererMode = "webgl" | "dom";

export type WebglLike = {
  dispose(): void;
  onContextLoss(listener: () => void): unknown;
  clearTextureAtlas?(): void;
};

export type RendererHost<A extends WebglLike> = {
  loadAddon(addon: A): void;
  /** The xterm terminal's own redraw and row count: a sibling pane whose glyphs were thrown away asks for a full repaint. */
  refresh?(start: number, end: number): void;
  readonly rows?: number;
};

export type RendererChoice = {
  /** The path drawing now (a parked pane draws plain until it is woken). */
  readonly mode: RendererMode;
  /** True while the pane draws plain only because the pool was full: it may still take a slot. */
  readonly waiting: boolean;
  /** Fires when a GPU pane has fallen back to the plain path after a context loss. */
  onFallback: (listener: (reason: string) => void) => void;
  /** Throw the glyph caches away (after a paste burst or a system resume); nothing on the plain path.
   *  The WebGL glyph atlas is shared by every GPU pane of the window, so every other live GPU pane
   *  also drops its drawn cells and repaints its whole screen. */
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

/** Panes of a pool whose GPU addon draws now. xterm's WebGL addon shares ONE glyph atlas between every
 *  terminal with the same font, theme and scale, but a terminal's drawn cells keep the atlas coordinates
 *  of the glyphs they were built from. Throwing the atlas away from one pane therefore leaves every other
 *  live pane pointing at coordinates that now hold other glyphs (same width, wrong letters) until its
 *  cells change. So a clear is told to every live pane of the pool. */
type Drawer = { rebuild(): void };
const drawersOfPool = new WeakMap<GpuPool, Set<Drawer>>();
const drawersOf = (pool: GpuPool) => {
  let set = drawersOfPool.get(pool);
  if (!set) drawersOfPool.set(pool, (set = new Set()));
  return set;
};

/** The WebGL context under an addon: xterm's addon keeps it as `_renderer._gl` (undefined if not reachable). */
type GlInside = { _renderer?: { _gl?: { getExtension?(name: string): { loseContext?(): void } | null } | null } | null };
const contextOf = (addon: unknown) => {
  try {
    return (addon as GlInside | null | undefined)?._renderer?._gl ?? undefined;
  } catch {
    return undefined;
  }
};

/** Disposes an addon and hands its WebGL context back to the browser at once, rather than at
 *  garbage collection: Chromium allows about sixteen contexts a page and force-loses the oldest past
 *  that, which could be a visible pane's (which then stays plain). The context is lost after
 *  dispose, once the addon's own loss listener is gone. */
const free = (addon: WebglLike | undefined) => {
  if (!addon) return;
  const gl = contextOf(addon);
  try {
    addon.dispose();
  } catch {
    /* already broken */
  }
  try {
    gl?.getExtension?.("WEBGL_lose_context")?.loseContext?.();
  } catch {
    /* already lost */
  }
};

const slotFreed = (pool: GpuPool) => {
  for (const fn of [...watchersOf(pool)]) {
    if (pool.live >= pool.max) return;
    fn();
  }
};

/** Settings key: `false` draws every terminal plain; absent or `true` lets the GPU path be tried. */
export const GPU_FIELD = "terminalGpu";
export const gpuOn = (settings: Record<string, unknown>): boolean => settings[GPU_FIELD] !== false;

/**
 * Bug 1155 (new terminal latency): making a WebGL context costs ~70 ms on this PC, and a new pane paid it before its
 * first frame and before its shell was asked to start. With `startPlain` the pane starts on the plain renderer and the
 * GPU path loads on the caller's `wake()`, after the first paint; nothing has been printed yet, so the swap is unseen.
 */
export function attachRenderer<A extends WebglLike>(host: RendererHost<A>, makeWebgl: () => A, preferGpu = true, pool: GpuPool = gpuPool, startPlain = false): RendererChoice {
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
  const drawers = drawersOf(pool);
  const me: Drawer = {
    rebuild() {
      // The shared atlas is already empty (the pane that cleared it just wiped it, and nothing has drawn
      // since), so this only drops this pane's drawn cells and asks for a redraw of the whole screen.
      addon?.clearTextureAtlas?.();
      host.refresh?.(0, Math.max(0, (host.rows ?? 1) - 1));
    },
  };
  const release = (quiet: boolean) => {
    const had = held;
    if (held) pool.live--;
    held = false;
    drawers.delete(me);
    // Offered after the current task: sibling panes unmounted in the same commit give their slots
    // back first instead of a dying pane's slot going to one of them.
    if (had && !quiet) queueMicrotask(() => slotFreed(pool));
  };
  const drop = (quiet = false) => {
    const was = addon;
    addon = undefined; // first: the loss our own release causes is then not read as a fallback
    free(was);
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
      free(made);
      refused = true;
      return false;
    }
    addon = made;
    held = true;
    pool.live++;
    drawers.add(me);
    return true;
  };
  if (startPlain) parked = !refused;
  else load();
  return {
    get mode(): RendererMode {
      return addon ? "webgl" : "dom";
    },
    get waiting() {
      return waiting && !refused && !gone && !addon;
    },
    onFallback,
    clearGlyphs() {
      if (!addon) return;
      addon.clearTextureAtlas?.();
      for (const other of [...drawers]) {
        if (other === me) continue;
        try {
          other.rebuild();
        } catch {
          /* that pane's context is going; its own loss handler takes it to the plain path */
        }
      }
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

/** Runs `fn` once the next frame has been painted (a frame callback, then a task after it); returns a cancel. */
export function afterPaint(fn: () => void): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const frame = requestAnimationFrame(() => {
    timer = setTimeout(fn, 0);
  });
  return () => {
    cancelAnimationFrame(frame);
    if (timer !== undefined) clearTimeout(timer);
  };
}

/** DT-C229: how long a pane stays hidden before its GPU context goes back to the pool. */
export const PARK_AFTER_MS = 30_000;

/** DT-C229: how long a reveal waits for synchronized output to end before it goes ahead anyway (just
 *  past xterm's own 1 s limit on it), so a program that never ends it never keeps the pane plain. */
export const SYNC_WAIT_MS = 1_100;

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
  /** True while the program holds the screen in synchronized output (xterm draws nothing then). */
  held?(): boolean;
  /** Calls `fn` once, later, when synchronized output has ended; returns the cancel. */
  whenFree?(fn: () => void): () => void;
};

type Parker = { hiddenSince: number | null; after: number; holds(): boolean; evict(): void };
const parkersOf = new WeakMap<GpuPool, Set<Parker>>();

/** DT-C229: parks `choice` once the pane has been hidden for `after` ms. On show, a parked pane, or
 *  one drawing plain only because the pool was full, takes a GPU context again and repaints before
 *  the frame is drawn (the pane calls `hidden(false)` from a layout effect). With the pool full it
 *  evicts the pane hidden longest, but only one hidden at least its own `after` (it would park
 *  anyway); otherwise it draws plain and takes the next slot freed. While the program holds the
 *  screen in synchronized output the take waits for it to end, so the new context's first frame is
 *  not blank. */
export function parkWhenHidden(
  choice: Pick<RendererChoice, "park" | "wake" | "mode" | "waiting">,
  hooks: ParkHooks,
  { after = PARK_AFTER_MS, wait = realWait, pool = gpuPool, now = Date.now }: { after?: number; wait?: Wait; pool?: GpuPool; now?: () => number } = {},
) {
  let cancel: (() => void) | null = null;
  let pending: (() => void) | null = null;
  let parked = false;
  let hidden = false;
  let parkers = parkersOf.get(pool);
  if (!parkers) parkersOf.set(pool, (parkers = new Set()));
  const all = parkers;
  const stopWaiting = () => {
    cancel?.();
    cancel = null;
  };
  const stopPending = () => {
    pending?.();
    pending = null;
  };
  const park = (quiet: boolean) => {
    stopWaiting();
    if (!choice.park(quiet)) return;
    parked = true;
    hooks.parked();
  };
  const me: Parker = { hiddenSince: null, after, holds: () => choice.mode === "webgl", evict: () => park(true) };
  all.add(me);
  const take = (force = false) => {
    if (pending) return;
    if (!force && hooks.whenFree && hooks.held?.()) {
      hooks.resume();
      const go = (forced: boolean) => () => {
        stopPending();
        if (!hidden) take(forced);
      };
      const offFree = hooks.whenFree(go(false));
      const offLate = wait(go(true), SYNC_WAIT_MS);
      pending = () => {
        offFree();
        offLate();
      };
      return;
    }
    let evicted = false;
    if (pool.live >= pool.max) {
      const t = now();
      let victim: Parker | null = null;
      for (const p of all) {
        if (p === me || p.hiddenSince === null || t - p.hiddenSince < p.after || !p.holds()) continue;
        if (victim === null || p.hiddenSince < (victim.hiddenSince as number)) victim = p;
      }
      if (victim) {
        victim.evict();
        evicted = true;
      }
    }
    hooks.resume();
    parked = false;
    const mode = choice.wake();
    // Still plain after a quiet eviction (the slot went elsewhere meanwhile, or this pane cannot take
    // one): the evicted slot is offered to the waiting panes after all.
    if (evicted && mode === "dom") queueMicrotask(() => slotFreed(pool));
    hooks.redraw(mode);
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
        stopPending();
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
      stopPending();
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

type SelectionInside = { _core?: { _selectionService?: { refresh?: (linux?: boolean) => void; readonly hasSelection?: boolean } } };

/**
 * DT-C245: xterm asks its selection to redraw on every line a program scrolls, selection or not, and the plain
 * renderer answers each ask by rebuilding every row on screen, so a flood rebuilt each pane's rows twice a frame.
 * This lets an ask through only while there is a selection, or once after it went away (to wipe its highlight).
 * Null when this xterm has no such service: then nothing changes. Returns the undo.
 */
export function quietSelection(term: unknown): (() => void) | null {
  const service = (term as SelectionInside | null | undefined)?._core?._selectionService;
  const refresh = service?.refresh;
  if (!service || typeof refresh !== "function" || typeof service.hasSelection !== "boolean") return null;
  let shown = false;
  service.refresh = function (this: unknown, linux?: boolean) {
    const has = service.hasSelection === true;
    if (!has && !shown) return;
    shown = has;
    refresh.call(service, linux);
  };
  return () => {
    service.refresh = refresh;
  };
}

// Renderer choice for a terminal pane (spec TERM-103): try the GPU path, keep working on the
// plain path if it fails to load or loses its context later. At most six panes hold a GPU
// context at a time, hidden tabs counted; the rest draw plain until a slot frees up. Pure so it
// can be tested without a browser; the pane hands in the real addon factory.

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
  mode: RendererMode;
  /** Fires when a GPU pane has fallen back to the plain path after a context loss. */
  onFallback: (listener: (reason: string) => void) => void;
  /** Throw the glyph caches away (after a paste burst or a system resume); nothing on the plain path. */
  clearGlyphs(): void;
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
  const plain: RendererChoice = { mode: "dom", onFallback, clearGlyphs() {}, dispose() {} };
  if (!preferGpu || pool.live >= pool.max) return plain;

  let addon: A | undefined;
  let held = false;
  const release = () => {
    if (held) pool.live--;
    held = false;
  };
  try {
    addon = makeWebgl();
    addon.onContextLoss(() => {
      addon?.dispose();
      addon = undefined;
      release();
      notify("context lost");
    });
    host.loadAddon(addon);
  } catch {
    try {
      addon?.dispose();
    } catch {
      /* already broken */
    }
    addon = undefined;
    return plain;
  }
  held = true;
  pool.live++;
  return {
    mode: "webgl",
    onFallback,
    clearGlyphs() {
      addon?.clearTextureAtlas?.();
    },
    dispose() {
      addon?.dispose();
      addon = undefined;
      release();
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

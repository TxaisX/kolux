// A surface that loads the first time it is drawn, not when the window starts: the pane bodies, the
// screens, the sheets and the dialogs all sit behind this. The shell lays the pane, tab and divider out
// at once, so nothing moves and no other pane loses focus while the body arrives a beat later (a file's
// own reading spinner is what the pane shows then, exactly as it does today while the file is read).
import { createElement, lazy, Suspense, type ComponentType, type ReactElement } from "react";

/** When a surface is read ahead of its first open (DT-C230, amended): stage 1 at the first idle moment
 *  after the first frame, stage 2 two seconds after that, stage 3 eight seconds after the window shows;
 *  stages 2 and 3 wait for a quiet moment. */
export type Warm = 1 | 2 | 3;

const stages: Record<Warm, Array<() => PromiseLike<unknown>>> = { 1: [], 2: [], 3: [] };

/** For tests: forgets every surface marked so far, so one test's marks do not reach the next. */
export const forgetStages = (): void => void ([1, 2, 3] as const).forEach((n) => (stages[n].length = 0));

/** Stage 2 starts this long after stage 1 has been read, stage 3 this long after `prefetch()` was called. */
export const STAGE_2_AFTER_MS = 2000;
export const STAGE_3_AFTER_MS = 8000;
/** A key or a press this recently means the user is working: the next read-ahead waits. */
export const ACTIVE_MS = 500;

/**
 * `load` names the module the surface lives in; its default export is the surface. `fallback` is drawn
 * while that code is read: only the full-page screens pass one (T-706), the rest draw nothing.
 * `opts.warm` names the stage `prefetch()` reads it in (`prefetch: true` is stage 1, what the surfaces
 * with no placeholder use). Once read, `get` hands the module over as a thenable that answers at once, so
 * React draws the surface on its first open without suspending (no fallback frame at all). A surface
 * opened before its stage ran loads on demand, as one that is never read ahead does. The component also
 * carries `warm()`, which reads the code now: a hover or a focus on the control that opens it calls it.
 */
export function deferred<P extends object>(load: () => Promise<{ default: ComponentType<P> }>, fallback?: ReactElement, opts: { prefetch?: boolean; warm?: Warm } = {}) {
  let mod: { default: ComponentType<P> } | undefined;
  // A bare thenable (no catch, no chaining), cast only because lazy()'s types ask for a Promise: it is for
  // lazy() and prefetch's allSettled alone, which is why `stages` holds PromiseLike, not Promise.
  const get = () => (mod ? ({ then: (ok: (m: typeof mod) => void) => ok(mod) } as Promise<typeof mod & object>) : load().then((m) => (mod = m)));
  const stage = opts.warm ?? (opts.prefetch === true ? 1 : undefined);
  if (stage) stages[stage].push(get);
  const Body = lazy(get);
  function Deferred(props: P): ReactElement {
    return createElement(Suspense, { fallback }, createElement(Body, props));
  }
  // A failed read is left alone here: the surface's own import() reports it when it is drawn.
  Deferred.warm = (): void => void Promise.resolve(get()).then(undefined, () => {});
  return Deferred;
}

type Idle = (f: () => void) => unknown;

/** What `prefetch()` takes from outside, so a test drives it with its own clock and its own idea of busy. */
export type PrefetchEnv = {
  idle?: Idle;
  now?: () => number;
  /** True while the user is working; the default is a key or a press in the last `ACTIVE_MS`, or the
   *  browser's own input-pending signal where it has one. */
  busy?: () => boolean;
};

function userBusy(now: () => number): () => boolean {
  const g = globalThis as { addEventListener?: (t: string, f: () => void, o?: unknown) => void };
  let last = -Infinity;
  for (const type of ["keydown", "pointerdown"]) g.addEventListener?.(type, () => (last = now()), { capture: true, passive: true });
  return () => {
    const pending = (globalThis as { navigator?: { scheduling?: { isInputPending?: () => boolean } } }).navigator?.scheduling?.isInputPending?.();
    return pending === true || now() - last < ACTIVE_MS;
  };
}

/**
 * Reads the code of the surfaces marked for it, in three stages (DT-C230, amended). Stage 1, at the
 * first idle moment: the chooser pane (a new pane, where keys typed before its code arrives would reach
 * the old one) and the sheets and menus with no placeholder, which would draw nothing for a beat on a
 * first open. Stage 2, two seconds later: the Board, the Agents list, the Inbox, the Explorer and the
 * settings page. Stage 3, eight seconds after the window shows: the browser pane and the editor. Stages 2
 * and 3 read one module per idle moment and hold back while the user is typing or pressing, so the
 * first seconds belong to the user. Nothing else is read ahead: every other surface loads on its first
 * open, behind DT-C142's placeholder for a full page. Called once, after the window is drawn and shown;
 * a failure is left alone (the surface's own import() reports it when it is drawn).
 */
export function prefetch(later: (f: () => void, ms: number) => unknown = setTimeout, env: PrefetchEnv = {}): void {
  const idle = env.idle ?? (globalThis as { requestIdleCallback?: Idle }).requestIdleCallback;
  const now = env.now ?? (() => performance.now());
  const busy = env.busy ?? userBusy(now);
  const started = now();
  // 1500 ms without an idle callback: long after the first frame, before the user is likely to have left Terminals.
  const whenIdle = (f: () => void, ms = 0) => (idle ? idle(f) : later(f, ms));

  const queue: Array<{ get: () => PromiseLike<unknown>; at: number }> = [];
  const step = (): void => {
    const next = queue[0];
    if (!next) return;
    const wait = next.at - now();
    if (wait > 0) return void later(step, wait);
    if (busy()) return void later(step, ACTIVE_MS);
    whenIdle(() => {
      queue.shift();
      void Promise.allSettled([next.get()]).then(step);
    });
  };
  whenIdle(() => {
    void Promise.allSettled(stages[1].map((get) => get()));
    const second = now() + STAGE_2_AFTER_MS;
    for (const get of stages[2]) queue.push({ get, at: second });
    // Stage 3 never starts before stage 2 has finished, whichever clock says it may.
    for (const get of stages[3]) queue.push({ get, at: Math.max(second, started + STAGE_3_AFTER_MS) });
    step();
  }, 1500);
}

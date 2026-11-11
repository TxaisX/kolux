// A surface that loads the first time it is drawn, not when the window starts: the pane bodies, the
// screens, the sheets and the dialogs all sit behind this. The shell lays the pane, tab and divider out
// at once, so nothing moves and no other pane loses focus while the body arrives a beat later (a file's
// own reading spinner is what the pane shows then, exactly as it does today while the file is read).
import { createElement, Suspense, useEffect, useRef, useState, type ComponentType, type ReactElement } from "react";

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
 * with no placeholder use). A surface whose code has been read (ahead of time, by a hover, or by an
 * earlier open) is drawn at once, with no fallback frame. One whose code has not been read is read on
 * its first open and drawn by a plain state change the moment it arrives. It never suspends: React holds
 * content that suspended back about 300 ms after its fallback showed, however quickly the code arrives
 * (measured: a dialog that used to open in 11 ms took 310 ms on its first open behind lazy()). The
 * component also carries `warm()`, which reads the code now: a hover or a focus on the control that
 * opens it calls it.
 */
export function deferred<P extends object>(load: () => Promise<{ default: ComponentType<P> }>, fallback?: ReactElement, opts: { prefetch?: boolean; warm?: Warm } = {}) {
  type Mod = { default: ComponentType<P> };
  let mod: Mod | undefined;
  let reading: Promise<Mod> | undefined;
  // One read at a time. Once read, a bare thenable that answers in the same turn (no catch, no chaining):
  // it is for prefetch's allSettled and for the effect below, which is why `stages` holds PromiseLike.
  const get = (): PromiseLike<Mod> => {
    if (mod) return { then: (ok: (m: Mod) => unknown) => ok(mod as Mod) } as PromiseLike<Mod>;
    reading ??= load().then(
      (m) => ((reading = undefined), (mod = m)),
      (e) => {
        reading = undefined; // a failed read is tried again by the next ask
        throw e;
      },
    );
    return reading;
  };
  const stage = opts.warm ?? (opts.prefetch === true ? 1 : undefined);
  if (stage) stages[stage].push(get);
  function Deferred(props: P): ReactElement | null {
    const [, arrived] = useState(0);
    const [failed, setFailed] = useState<{ error: unknown } | null>(null);
    // what this draw showed: the effect below asks for the code only when it was the fallback
    const drawn = useRef(false);
    drawn.current = mod !== undefined;
    useEffect(() => {
      if (drawn.current) return;
      let live = true;
      void Promise.resolve(get()).then(
        () => live && arrived((n) => n + 1),
        (error: unknown) => live && setFailed({ error }),
      );
      return () => {
        live = false;
      };
    }, []);
    // A failed read is thrown while drawing, as lazy() did: the boundary above (ScreenBoundary) reports it.
    if (failed) throw failed.error;
    // The Suspense stays for what the surface itself may suspend on (a part of it that loads later).
    return mod ? createElement(Suspense, { fallback }, createElement(mod.default, props)) : (fallback ?? null);
  }
  // A failed read is left alone here: the surface's own read reports it when it is drawn.
  Deferred.warm = (): void => void Promise.resolve(get()).then(undefined, () => {});
  /** The same read for a caller that waits for it (the Settings pages' warm-up, one page at a time). */
  Deferred.read = (): Promise<unknown> => Promise.resolve(get());
  return Deferred;
}

/** Marks other code for a stage of the read-ahead, for what is not a surface of its own (the Settings pages'
 *  code): `read` is called once, when its stage reaches it, and the stage goes on when what it returns settles. */
export const ahead = (stage: Warm, read: () => PromiseLike<unknown>): void => void stages[stage].push(read);

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

// A surface that loads the first time it is drawn, not when the window starts: the pane bodies, the
// screens, the sheets and the dialogs all sit behind this. The shell lays the pane, tab and divider out
// at once, so nothing moves and no other pane loses focus while the body arrives a beat later (a file's
// own reading spinner is what the pane shows then, exactly as it does today while the file is read).
import { createElement, lazy, Suspense, type ComponentType, type ReactElement } from "react";

/** Every surface, in the order it was declared. `prefetch()` reads those made with `{ prefetch: true }`
 *  at the first idle moment after the first frame, and the rest about ten seconds later (DT-C230). */
const loaders: Array<{ get: () => PromiseLike<unknown>; eager: boolean }> = [];

/**
 * `load` names the module the surface lives in; its default export is the surface. `fallback` is drawn
 * while that code is read: only the full-page screens pass one (T-706), the rest draw nothing.
 * Once `prefetch()` has read the module, `get` hands it over as a thenable that answers at once, so
 * React draws the surface on its first open without suspending (no fallback frame at all).
 */
export function deferred<P extends object>(load: () => Promise<{ default: ComponentType<P> }>, fallback?: ReactElement, opts: { prefetch?: boolean } = {}) {
  let mod: { default: ComponentType<P> } | undefined;
  // A bare thenable (no catch, no chaining), cast only because lazy()'s types ask for a Promise: it is for
  // lazy() and prefetch's allSettled alone, which is why `loaders` holds PromiseLike, not Promise.
  const get = () => (mod ? ({ then: (ok: (m: typeof mod) => void) => ok(mod) } as Promise<typeof mod & object>) : load().then((m) => (mod = m)));
  loaders.push({ get, eager: opts.prefetch === true });
  const Body = lazy(get);
  return function Deferred(props: P): ReactElement {
    return createElement(Suspense, { fallback }, createElement(Body, props));
  };
}

/** DT-C230: how long after the window is up the surfaces not marked for prefetch are read. */
export const LATE_PREFETCH_MS = 10_000;

type Idle = (f: () => void, opts?: { timeout: number }) => unknown;

/**
 * Reads surface code in the background in two steps (DT-C230), so the first seconds after start stay
 * light and nothing is still unread once the user starts moving around: at the first idle moment the
 * surfaces marked for it (the editor and the browser pane, and the settings page, the plan sheet and
 * the tab menu, which have no placeholder and would draw nothing for a beat on their first open); about
 * LATE_PREFETCH_MS later, at an idle moment (at most five seconds more), every other surface. A surface
 * opened before then loads on its own, behind DT-C142's placeholder for a full page. Called once, after
 * the window is drawn and shown; a failure is left alone (the surface's own import() reports it when it
 * is drawn).
 */
export function prefetch(later: (f: () => void, ms: number) => unknown = setTimeout): void {
  const idle = (globalThis as { requestIdleCallback?: Idle }).requestIdleCallback;
  const read = (eager: boolean) => () => void Promise.allSettled(loaders.filter((l) => l.eager === eager).map((l) => l.get()));
  // 1500 ms: long after the first frame, before the user is likely to have left Terminals.
  if (idle) idle(read(true));
  else later(read(true), 1500);
  later(() => (idle ? idle(read(false), { timeout: 5_000 }) : read(false)()), LATE_PREFETCH_MS);
}

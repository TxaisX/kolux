// A surface that loads the first time it is drawn, not when the window starts: the pane bodies, the
// screens, the sheets and the dialogs all sit behind this. The shell lays the pane, tab and divider out
// at once, so nothing moves and no other pane loses focus while the body arrives a beat later (a file's
// own reading spinner is what the pane shows then, exactly as it does today while the file is read).
import { createElement, lazy, Suspense, type ComponentType, type ReactElement } from "react";

/** The surfaces made with `{ prefetch: true }`, in the order they were declared: `prefetch()` reads them
 *  after the first frame. Every other surface is read the first time it is drawn (DT-C230). */
const loaders: Array<() => PromiseLike<unknown>> = [];

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
  if (opts.prefetch) loaders.push(get);
  const Body = lazy(get);
  return function Deferred(props: P): ReactElement {
    return createElement(Suspense, { fallback }, createElement(Body, props));
  };
}

/**
 * Reads the code of the surfaces marked for it (the editor and the browser pane, DT-C230) in the
 * background, so the first frame stays small and those two are still ready when the user opens one.
 * The rest load on first open, behind DT-C142's placeholder for a full page. Called once, after the
 * window is drawn and shown; a failure is left alone (the surface's own import() reports it when it is drawn).
 */
export function prefetch(): void {
  const idle = (globalThis as { requestIdleCallback?: (f: () => void) => void }).requestIdleCallback;
  // 1500 ms: long after the first frame, before the user is likely to have left Terminals.
  const run = () => void Promise.allSettled(loaders.map((l) => l()));
  if (idle) idle(run);
  else setTimeout(run, 1500);
}

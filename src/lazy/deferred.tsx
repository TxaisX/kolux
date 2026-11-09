// A surface that loads the first time it is drawn, not when the window starts: the pane bodies, the
// screens, the sheets and the dialogs all sit behind this. The shell lays the pane, tab and divider out
// at once, so nothing moves and no other pane loses focus while the body arrives a beat later (a file's
// own reading spinner is what the pane shows then, exactly as it does today while the file is read).
import { createElement, lazy, Suspense, type ComponentType, type ReactElement } from "react";

/** The surfaces made with `{ prefetch: true }`, in the order they were declared: `prefetch()` reads
 *  them at the first idle moment after the first frame (DT-C230). Every other surface is read only
 *  when it is first opened, so code the user never opens is never held in memory. */
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
  if (opts.prefetch === true) loaders.push(get);
  const Body = lazy(get);
  return function Deferred(props: P): ReactElement {
    return createElement(Suspense, { fallback }, createElement(Body, props));
  };
}

type Idle = (f: () => void) => unknown;

/**
 * Reads the code of the surfaces marked for it at the first idle moment (DT-C230): the editor, the
 * browser pane and the chooser pane (a new pane, where keys typed before its code arrives would reach
 * the old one), and the settings page, the plan sheet, the help sheet and the tab menu, which have no
 * placeholder and would draw nothing for a beat on their first open. Nothing else is read ahead: the goal is a lighter
 * app, so every other surface loads on its first open, behind DT-C142's placeholder for a full page.
 * Called once, after the window is drawn and shown; a failure is left alone (the surface's own
 * import() reports it when it is drawn).
 */
export function prefetch(later: (f: () => void, ms: number) => unknown = setTimeout): void {
  const idle = (globalThis as { requestIdleCallback?: Idle }).requestIdleCallback;
  const read = () => void Promise.allSettled(loaders.map((get) => get()));
  // 1500 ms: long after the first frame, before the user is likely to have left Terminals.
  if (idle) idle(read);
  else later(read, 1500);
}

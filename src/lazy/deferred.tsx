// A surface that loads the first time it is drawn, not when the window starts: the pane bodies, the
// screens, the sheets and the dialogs all sit behind this. The shell lays the pane, tab and divider out
// at once, so nothing moves and no other pane loses focus while the body arrives a beat later (a file's
// own reading spinner is what the pane shows then, exactly as it does today while the file is read).
import { createElement, lazy, Suspense, type ComponentType, type ReactElement } from "react";

/** Every surface made here, in the order it was declared: `prefetch()` reads them after the first frame. */
const loaders: Array<() => Promise<unknown>> = [];

/**
 * `load` names the module the surface lives in; its default export is the surface. `fallback` is drawn
 * while that code is read: only the full-page screens pass one (T-706), the rest draw nothing.
 */
export function deferred<P extends object>(load: () => Promise<{ default: ComponentType<P> }>, fallback: ReactElement | null = null) {
  loaders.push(load);
  const Body = lazy(load);
  return function Deferred(props: P): ReactElement {
    return createElement(Suspense, { fallback }, createElement(Body, props));
  };
}

/**
 * Reads the code of every deferred surface in the background, so the first frame stays small and the
 * next screen is still ready when the user gets to it. Called once, after the window is drawn and
 * shown; a failure is left alone (the surface's own import() reports it when it is drawn).
 */
export function prefetch(): void {
  const idle = (globalThis as { requestIdleCallback?: (f: () => void) => void }).requestIdleCallback;
  // 1500 ms: long after the first frame, before the user is likely to have left Terminals.
  const run = () => void Promise.allSettled(loaders.map((l) => l()));
  if (idle) idle(run);
  else setTimeout(run, 1500);
}

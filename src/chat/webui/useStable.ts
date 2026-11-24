// A callback that keeps one identity for the life of the component but always runs the newest function it was
// given. A chat pane redraws on every streamed word; the history column and the model picker take callbacks
// that close over the pane's state, so without this every word would redraw them (their memo would never hold).
import { useCallback, useRef } from "react";

export function useStable<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  const latest = useRef(fn);
  latest.current = fn;
  return useCallback((...args: A) => latest.current(...args), []);
}

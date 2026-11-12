// SET-017: a screen that calls `t()` while its language pack is still loading shows English; this
// redraws it once the pack arrives (and on every later pack load, e.g. a language switch).
import { useEffect, useReducer } from "react";
import { onPackLoaded } from "../i18n/lookup";

export function usePackLoaded(): void {
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  useEffect(() => onPackLoaded(() => redraw()), []);
}

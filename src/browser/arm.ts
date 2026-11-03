// UX audit (browser pane): a two-step confirm for a destructive button. The first press arms it (the button says what a
// second press does) and the arming lapses by itself, so nothing is lost by a single stray click.
import { useEffect, useState } from "react";

export const ARM_MS = 4000;

/** `[armed, press]`: `press(run)` arms on the first call and runs `run` on the next one within ARM_MS. */
export function useArm(ms = ARM_MS): [boolean, (run: () => void) => void] {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = window.setTimeout(() => setArmed(false), ms);
    return () => window.clearTimeout(t);
  }, [armed, ms]);
  return [
    armed,
    (run) => {
      if (!armed) return setArmed(true);
      setArmed(false);
      run();
    },
  ];
}

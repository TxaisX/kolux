// C26-R2-01: a clicked desktop notification lands on the pane that raised it, the same jump the
// rail, the Inbox and the needs-you key already take (paneActions.openPane). The click handler used
// to write `focused` alone, so a pane in another workspace, behind another screen or behind a full
// page never came into view, and the next chord acted on a terminal the user could not see.
import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";

/** The pane a click names, or undefined when it is no longer open (a stale notification id). */
export function clickedPane(payload: { pane: string }, panes: readonly { key: number }[]): number | undefined {
  const key = Number(payload.pane);
  return panes.some((x) => x.key === key) ? key : undefined;
}

/**
 * The listener's deps are the live pane list, so the jump is read from a ref each time: calling the
 * action directly would close over the panes and active folder of the first render.
 */
export function useNotificationClick(panesRef: { current: readonly { key: number }[] }, jump: { current: (key: number) => void }) {
  useEffect(() => {
    const off = listen<{ pane: string }>("notification-click", (e) => {
      const key = clickedPane(e.payload, panesRef.current);
      if (key !== undefined) jump.current(key);
    });
    return () => {
      void off.then((f) => f());
    };
  }, [panesRef]);
}

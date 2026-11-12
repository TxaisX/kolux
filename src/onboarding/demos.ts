// ONB-025 (T-322-b): the looping demos of Explore Kolux. They pause while the window is hidden and carry on from the
// same point (hidden time never counts), show the platform's own shortcut keys (no Cmd symbols on Windows), and keep
// a fixed order and loop length. Pure; Demo.tsx drives the clock.
import { defaultsOnly, labelOf } from "../keys/keymap";
import type { Platform } from "../keys/actions";

/** A gap between two clock readings longer than this is a stalled or throttled timer, not time spent watching. */
export const MAX_STEP_MS = 500;

/** The demo's position in its loop. `tick` takes the clock and whether the window is visible; hidden readings
 *  advance nothing, and the first reading after a hidden spell only restarts the clock, so the demo never jumps ahead. */
export function createLoop(frames: number, frameMs: number) {
  let at = 0; // ms into the loop
  let last: number | null = null;
  const frame = () => Math.floor(at / frameMs) % frames;
  return {
    tick(now: number, visible: boolean): number {
      if (!visible) {
        last = null;
        return frame();
      }
      if (last !== null) at = (at + Math.min(Math.max(now - last, 0), MAX_STEP_MS)) % (frames * frameMs);
      last = now;
      return frame();
    },
    frame,
  };
}

/** An action's default shortcut as the demo prints it, from the app's own labels: "Ctrl+Shift+J" on Windows, "Cmd+J" on a
 *  Mac. A double tap reads "Shift Shift" (one cap, no plus). */
export const keysText = (action: string, platform: Platform): string => labelOf(defaultsOnly(platform), action).join("+");

export type Demo = { id: "workspaces" | "workbench" | "statuses"; frames: string[] };

/** Which demo a workflow or stop carries; the others carry none. */
export const demoFor = (id: string): Demo["id"] | null => (id === "workspaces" || id === "workbench" || id === "statuses" ? id : null);

/** The frames of a demo, in their fixed order. Words only; the keys come from the platform. */
export function framesOf(id: Demo["id"], platform: Platform): string[] {
  const palette = keysText("worktree.palette", platform);
  const newTab = keysText("tab.newTerminal", platform);
  switch (id) {
    case "workspaces":
      return ["fix-login: agent working", "dark-mode: agent working", "export-csv: waiting for you", "fix-login: done"];
    case "workbench":
      return [`Run queue: 1 of 3 running (${palette} to switch)`, "Run queue: 2 of 3 running", `Run queue: 3 of 3 running (${newTab} for a new tab)`];
    case "statuses":
      return ["Working", "Waiting for you", "Done"];
  }
}

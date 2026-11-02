// The few names the rest of the app reaches the update center by (Help, the command palette, recovery, the
// status bar). They live here, not in the component, so importing them does not pull the whole update
// screen into the first load (scripts/bundle-budget.mjs). UpdateCenter.tsx re-exports them under the old paths.
import type { BarItem } from "./card";

const EVENT = "kolux-check-updates";
/** A check the user asked for: Help, the command palette and recovery send it. */
export function requestUpdateCheck() {
  window.dispatchEvent(new Event(EVENT));
}
export const CHECK_EVENT = EVENT;

// VIEW-100: the status bar reads the update item from here, so a bar shown again picks it up.
export const BAR_EVENT = "kolux-update-bar";
export const SHOW_EVENT = "kolux-update-show";
let bar: BarItem | null = null;
export const currentBar = () => bar;
export const setBar = (b: BarItem | null) => {
  bar = b;
};

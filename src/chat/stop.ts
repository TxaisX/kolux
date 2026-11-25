// Native chat, the Send / Stop button (CHAT-018; T-329). While a turn runs the button beside the
// box reads Stop. A quick second click on Send must never land on that Stop, so a Stop pressed
// within STOP_ARM_MS of a send made by a click on that button does nothing (the click that sent and
// the click that follows it are one gesture, not an interrupt). A send made from the keyboard has no
// second click, so Stop counts at once after it: a Stop right after Enter is never swallowed.

/** A Stop pressed this soon after a click on Send is ignored. */
export const STOP_ARM_MS = 700;

/** How the box sent: a click on the Send button, or the keyboard (Enter, a line picked in a menu). */
export type SentBy = "click" | "key";

/** When the guard starts counting for a send made at `now`: only a click on the button starts it. */
export const guardedFrom = (by: SentBy, now: number): number | null => (by === "click" ? now : null);

/** What the button is: Stop while the agent works, unless it is asking something (the permission
 * card answers that, and Escape there would answer it for the user). */
export const buttonMode = (working: boolean, asking: boolean): "send" | "stop" => (working && !asking ? "stop" : "send");

/** True when a Stop click at `now` counts. `sentAt`: when the button last sent by a click (null: never, or the last send came from the keyboard). */
export const stopArmed = (sentAt: number | null, now: number): boolean => sentAt === null || now - sentAt >= STOP_ARM_MS;

/** What the box says between the click and the agent confirming the turn ended. */
export const STOPPING_NOTE = "Stopping the agent…";
/** When Escape never reached the agent (no terminal, or it is asking something). */
export const CANNOT_STOP_NOTE = "Could not stop the agent from here. Press Escape in its terminal.";

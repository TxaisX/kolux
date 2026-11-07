// SET-014: who gets a chord while a terminal has focus. Kolux first (the default): every app
// shortcut keeps working. Terminal first: only the commands marked safe for terminals fire and
// every other chord goes to the program in the terminal. It covers every terminal pane,
// because all of them are xterm views.
import { actionById } from "./actions";
import { runningCommand } from "./runCommand";

export const POLICY_FIELD = "terminalShortcuts";
export type Policy = "kolux" | "terminal";
export const POLICIES: Array<{ id: Policy; label: string }> = [
  { id: "kolux", label: "Kolux first" },
  { id: "terminal", label: "Terminal first" },
];

export const readPolicy = (s: Record<string, unknown> | null | undefined): Policy => (s?.[POLICY_FIELD] === "terminal" ? "terminal" : "kolux");

/** SET 008: what a command does while a terminal has focus; null when it never fires there. */
export function inTerminal(id: string, policy: Policy): "works" | "held" | null {
  const a = actionById.get(id);
  if (!a || !["global", "tabs", "terminal"].includes(a.scope)) return null;
  return policy === "kolux" || a.terminalSafe ? "works" : "held";
}

/** The window's key handler leaves this command's chord to the terminal program. T-611: never a command
 *  picked in the palette, which is no key the program could be waiting for. */
export const heldByTerminal = (id: string, settings: Record<string, unknown> | null | undefined, active: Element | null = document.activeElement): boolean =>
  !runningCommand() && readPolicy(settings) === "terminal" && !!active?.closest(".xterm") && inTerminal(id, "terminal") === "held";

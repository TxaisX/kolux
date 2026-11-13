// T-611: a command picked in the palette runs through the same code its shortcut runs. A stand-in keydown
// goes to the element that has the keyboard, as the chord would, and matchEvent (keymap.ts) answers that one
// event with the command, so the window's key switch, a pane's or the editor's handles it as it handles the
// chord, and an unbound command runs too. ponytail: a stand-in key event, not a command registry; the
// upgrade path is a registry the key listeners call as well, once the window's key switch leaves App.tsx.

type Pending = { event: object; id: string; index?: number; answered?: boolean };
let pending: Pending | null = null;

/** The command a stand-in key event carries; null for every real key press. */
export const commandOf = (e: object): Pending | null => (pending !== null && pending.event === e ? pending : null);

/** Review of PR #16: a key listener whose scope is live took the command (keymap.ts matchEvent). */
export const answerCommand = (p: Pending): void => void (p.answered = true);

/** Review of PR #16: what the palette says when no live place took a command, by the command's scope. */
const NOTES: Record<string, string> = {
  editor: "Open a file in an editor tab first.",
  explorer: "Open the file explorer first.",
  settings: "Open Settings first.",
  terminal: "Focus a terminal first.",
  tabs: "Open a workspace with tabs first.",
};
export const scopeNote = (scope: string | undefined): string => NOTES[scope ?? ""] ?? "That command has nothing to act on here.";

/** True while a command picked in the palette runs: the terminal never holds it (terminalPolicy.ts). */
export const runningCommand = (): boolean => pending !== null;

type Where = { later?: (f: () => void) => void; target?: EventTarget; event?: () => Event; scope?: string; unanswered?: (note: string) => void };

/** Runs command `id` (with its digit for the two 1 to 9 commands) once the palette has closed and given the
 *  keyboard back to where it was opened from. */
export function runCommand(id: string, index?: number, where: Where = {}): void {
  const later = where.later ?? ((f: () => void) => void setTimeout(f, 0));
  later(() => {
    const target = where.target ?? document.activeElement ?? document.body;
    const event = where.event?.() ?? new KeyboardEvent("keydown", { key: "Unidentified", bubbles: true, cancelable: true });
    const mine: Pending = { event, id, index };
    pending = mine;
    try {
      target.dispatchEvent(event);
    } finally {
      pending = null;
    }
    // Review of PR #16: never silent. A command whose place (an editor, a browser pane, the explorer,
    // Settings) is not open says so instead of doing nothing; the command stays listed.
    if (!mine.answered) where.unanswered?.(scopeNote(where.scope));
  });
}

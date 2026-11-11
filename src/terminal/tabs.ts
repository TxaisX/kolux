// Tab badges (TERM-055) and the unread rule for a finish or a bell (TERM-118). Pure, tested on
// its own. The permission badge is fed by `needs`: the pane's one status is a permission or a question
// (board/chip.ts needsYou, DT-C52), never the pane header's own attention flag.

import type { AgentState } from "../projects/rows";

/** `background` is the radio mark for an agent whose turn is over while Kolux watches its background work (STAT-024); only the palette rows carry it so far (VIEW-040). */
/** `stopped` (DT-C52): a blocked or interrupted agent, the Stopped the Board and the Tower show; it is not a question. */
export type Badge = "working" | "background" | "permission" | "unread" | "done" | "stopped" | null;

/**
 * The one badge a tab shows: a working agent spins, one waiting on the user shows the question
 * mark, an unvisited finish (or bell) keeps the bell, a visited finish the check. An idle shell
 * shows only its identity icon.
 */
export function tabBadge(agent: string, running: boolean | undefined, needs: boolean, unread: boolean, hook?: AgentState): Badge {
  if (agent === "shell") return unread ? "unread" : null;
  if (running !== false) {
    if (needs) return "permission";
    if (hook === "blocked" || hook === "interrupted") return unread ? "unread" : "stopped";
    // STAT-001: the hook says the turn is over while the program still runs.
    if (hook === "done") return unread ? "unread" : "done";
    return "working";
  }
  // DT-C52: an agent whose program exited is Stopped on every surface
  return unread ? "unread" : "stopped";
}

/**
 * Whether a finish or bell on pane `key` marks it unread: not for the pane in view in a focused
 * window; a hidden tab, a hidden split pane or a window in the background is marked. A late event
 * for a pane that is gone or already marked is dropped.
 */
export function marksUnread(key: number, known: Set<number>, marked: Set<number>, inView: boolean, windowFocused: boolean): boolean {
  if (!known.has(key) || marked.has(key)) return false;
  return !(inView && windowFocused);
}

/** TERM-027, TERM-048: what a key does in a pane-title or tab-name field. An Enter that only
 *  confirms an IME candidate (composing, or the 229 key code some IMEs send) does nothing. */
export function nameKey(e: { key: string; isComposing: boolean; keyCode: number }): "save" | "cancel" | null {
  if (e.isComposing || e.keyCode === 229) return null;
  if (e.key === "Enter" || e.key === "Tab") return "save";
  return e.key === "Escape" ? "cancel" : null;
}

/** The name kept from a field: trimmed, and blank gives the automatic title back. */
export const newName = (text: string): string | undefined => text.trim() || undefined;

/** TERM-029: the sessions in this grid (keys in grid order) waiting on a permission or a question. */
export const waitingInGrid = (keys: number[], hook: Partial<Record<number, AgentState>>): number[] =>
  keys.filter((k) => hook[k] === "permission" || hook[k] === "waiting");

/** TERM-096: the terminal handles printed in a line (term-N as a whole word), with where each sits in the text
 *  (string offsets; links.ts handlesOn places them on cells, T-586). */
export const handlesIn = (text: string): { start: number; end: number; handle: string }[] =>
  [...text.matchAll(/(?<![\w-])term-\d+(?![\w-])/g)].map((m) => ({ start: m.index, end: m.index + m[0].length, handle: m[0] }));

/** TERM-048: a tab's right-click menu. Only terminal and agent tabs (no kind) take a name. */
export const tabMenu = (kind: string | undefined): { id: "rename" | "close"; label: string; keys?: string }[] => [
  ...(kind ? [] : [{ id: "rename" as const, label: "Rename tab", keys: "tab.rename" }]),
  { id: "close", label: "Close tab" },
];

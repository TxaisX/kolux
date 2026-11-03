// T-569 (Txais 2026-10-28): a workspace with no pane yet starts with the launch chooser in its first cell,
// not a terminal: nothing runs until the person picks an AI session or a plain terminal. A freshly made
// workspace gets as many choosers as the default pane count. Panes restored from the saved layout never come here.
// T-664 (b) (Txais 2026-11-02): the new-workspace form's AI and note arrive as a prefill: the first chooser opens with
// Seat 1 on that AI and the note as the task for every seat. Nothing runs until the person presses Start.
import type { Pane } from "../App";
import { emptySeat, type Seat } from "../launch/seats";

/** The form's pick as the form gives it; `select` turns the agent into a finished seat (the dropdown's own default model and effort). */
export type StartPrefill = { agent: string | null; task: string };

export function startPanes(dir: string, branch: string | null, count: number, nextKey: () => number, prefill?: { seat: Seat; task: string }): Pane[] {
  return Array.from({ length: Math.max(1, count) }, (_, i): Pane => {
    const filled = i === 0 && prefill !== undefined;
    return { key: nextKey(), cwd: dir, branch: i === 0 ? branch : null, agent: "shell", program: null, args: [], seats: [filled ? prefill.seat : emptySeat()], ...(filled && prefill.task ? { task: prefill.task } : {}) };
  });
}

/** T-664 (b): what the new-workspace form's create does once the workspace exists. `front`: it takes the front (a chooser
 * can show). `waits`: a setup script must finish before an agent starts. A front create never starts an agent. */
export type CreateStart = "select-prefill" | "select" | "start" | "setup-then-start" | "none";
export function createStart(hasAgent: boolean, hasNote: boolean, front: boolean, waits: boolean): CreateStart {
  if (front) return hasAgent || hasNote ? "select-prefill" : "select";
  return hasAgent ? (waits ? "setup-then-start" : "start") : "none";
}

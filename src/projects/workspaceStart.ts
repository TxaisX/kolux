// T-569 (Txais 2026-10-28): a workspace with no pane yet starts with the launch chooser in its first cell,
// not a terminal: nothing runs until the person picks an AI session or a plain terminal. A freshly made
// workspace gets as many choosers as the default pane count. Panes restored from the saved layout never come here.
// T-664 (b) (Txais 2026-11-02): the new-workspace form's AI and note arrive as a prefill: the first chooser opens with
// Seat 1 on that AI and the note as the task for every seat. Nothing runs until the person presses Start.
import type { Pane } from "../App";
import { emptySeat } from "../launch/seats";

export type StartPrefill = { agent: string | null; task: string };

export function startPanes(dir: string, branch: string | null, count: number, nextKey: () => number, prefill?: StartPrefill): Pane[] {
  return Array.from({ length: Math.max(1, count) }, (_, i): Pane => {
    const filled = i === 0 && prefill !== undefined;
    return { key: nextKey(), cwd: dir, branch: i === 0 ? branch : null, agent: "shell", program: null, args: [], seats: [filled ? { ...emptySeat(), agent: prefill.agent } : emptySeat()], ...(filled && prefill.task ? { task: prefill.task } : {}) };
  });
}

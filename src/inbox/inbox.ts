// The Inbox (STAT-050): what needs you, what is waiting on an agent and what finished today,
// built from what the window already knows about its panes; and the arrow-key walk over the
// three groups. Pure, tested on its own.

import { paneState, type AgentState } from "../projects/rows";

export type Group = "needs" | "waiting" | "done" | "stopped";
export type Source = { key: number; agent: string; title: string; branch: string | null; cwd: string | null; state: AgentState; interrupted: boolean; running: boolean; changed: number; finishedAt: number | null };
/** `exited` (T-035-b): the question or permission is still open but the agent's terminal is gone. */
/** `state` "stopped" (DT-C52): an agent whose program has exited, as the Board and the Tower show it. */
export type Item = Omit<Source, "finishedAt" | "running" | "interrupted" | "changed" | "state"> & { state: AgentState | "stopped"; group: Group; label: string; when: number; exited: boolean };

export const GROUPS: Array<{ id: Group; title: string; about: string }> = [
  { id: "needs", title: "Needs you", about: "A permission, a question, or a blocked session. A blocked session stays here; the Board and the Tower call it Stopped." },
  { id: "waiting", title: "Waiting on agent", about: "Sessions running their turn, or queued for it." },
  { id: "done", title: "Done today", about: "Finished its turn in the last 30 minutes, with its program still running." },
  { id: "stopped", title: "Stopped", about: "Its program exited in the last 30 minutes, so Kolux cannot say its work finished." },
];
/** Done today keeps the 20 newest finishes of the last 30 minutes; Stopped the same for programs that exited. */
export const DONE_LIMIT = 20;
export const DONE_WINDOW_MS = 30 * 60_000;

/** Prompts that ask for approval are permissions, the rest questions (STAT-050). A blocked agent (a limit or a
 *  sign-in) is listed too, as on main (review of PR #16: whether it should is a question for Txais). */
const NEEDS: Partial<Record<AgentState, string>> = { permission: "Permission", waiting: "Question", blocked: "Blocked" };

/** T-608: one pane as the Inbox reads it: its one status (board/chip.ts paneStatus), else what its program
 *  says (an agent works until it ends). `stamp` is when its state last moved. */
export function sourceOf(p: { key: number; agent: string; branch: string | null; cwd: string | null }, title: string, status: AgentState | undefined, running: boolean | undefined, stamp?: { at: number; interrupted: boolean }): Source {
  const state = status ?? paneState(p.agent, running);
  return { key: p.key, agent: p.agent, title, branch: p.branch, cwd: p.cwd, state, interrupted: stamp?.interrupted ?? false, running: running !== false, changed: stamp?.at ?? 0, finishedAt: state === "done" ? (stamp?.at ?? null) : null };
}

export function inboxItems(sources: Source[], now: number): Item[] {
  const item = (s: Source, group: Group, label: string, when: number): Item => ({ key: s.key, agent: s.agent, title: s.title, branch: s.branch, cwd: s.cwd, state: group === "stopped" ? "stopped" : s.state, group, label, when, exited: group === "needs" && !s.running });
  const newest = (a: Item, b: Item) => b.when - a.when;
  const needs = sources.filter((s) => NEEDS[s.state]).map((s) => item(s, "needs", NEEDS[s.state]!, s.changed));
  const waiting = sources.filter((s) => s.running && (s.state === "working" || s.state === "queued")).map((s) => item(s, "waiting", s.state === "queued" ? "Queued" : "Running", s.changed));
  const recent = (s: Source) => s.finishedAt !== null && now - s.finishedAt <= DONE_WINDOW_MS;
  // DT-C52 (Txais, 2026-10-31): an agent whose program has exited is Stopped, as on the Board and the Tower
  // (chipOf), not Done today: the window does not keep its exit code, so it cannot say the work finished.
  const stopped = sources.filter((s) => s.state === "done" && !s.running && recent(s)).map((s) => item(s, "stopped", "Stopped", s.finishedAt!));
  // Interrupted sessions and anything older than 30 minutes stay out of done today.
  const done = sources.filter((s) => s.state === "done" && s.running && !s.interrupted && recent(s)).map((s) => item(s, "done", "Done", s.finishedAt!));
  return [...needs.sort(newest), ...waiting.sort(newest), ...done.sort(newest).slice(0, DONE_LIMIT), ...stopped.sort(newest).slice(0, DONE_LIMIT)];
}

/** Up and Down walk the rows in order; with nothing selected Down picks the first and Up the last; both ends stop. */
export function moveSelection(keys: number[], selected: number | null, dir: 1 | -1): number | null {
  if (keys.length === 0) return null;
  const i = selected === null ? -1 : keys.indexOf(selected);
  if (i < 0) return dir > 0 ? keys[0] : keys[keys.length - 1];
  return keys[Math.min(Math.max(i + dir, 0), keys.length - 1)];
}

/** A selection whose row disappeared goes back to the first row. */
export function settle(keys: number[], selected: number | null): number | null {
  if (selected === null) return null;
  return keys.includes(selected) ? selected : (keys[0] ?? null);
}

/** T-035-b: what the detail says for a prompt whose terminal has exited; null when the terminal is alive. */
export function exitNote(item: Pick<Item, "exited" | "state">): string | null {
  if (!item.exited) return null;
  // A stop (a limit or a sign-in) is not a prompt: it has no question to answer, only a reason to read.
  if (item.state === "blocked") return "The agent stopped and its terminal has exited. Open its pane in Code to see why.";
  return "Its terminal has exited, so the prompt cannot be answered from here. Answer in Code to see it in the pane.";
}

/** EDIT-041: the detail's button. Nothing is answered in the Inbox itself yet, so a question or a
 *  permission always sends the user to the agent's pane to answer it there. */
export function openLabel(item: Pick<Item, "group">): "Answer in Code" | "Open in Code" {
  return item.group === "needs" ? "Answer in Code" : "Open in Code";
}

/** Whether a key press came from the detail pane (one of its buttons), where Enter and Space belong to that button, not to the list. */
export function fromDetail(target: { closest?: (selector: string) => unknown } | null | undefined): boolean {
  return !!target?.closest?.(".detail");
}

/** The detail's "Changes" line: waiting, no workspace, the read failed (said, never shown as "No files changed"), or the count. */
export function changesLine(o: { hasCwd: boolean; changed: number | null; staged: number; failed: string | null }): string {
  if (o.failed) return `Could not read the changes: ${o.failed}`;
  if (o.changed === null) return o.hasCwd ? "…" : "—";
  if (o.changed === 0) return "No files changed";
  return `${o.changed} file${o.changed === 1 ? "" : "s"} changed${o.staged ? `, ${o.staged} staged` : ""}`;
}

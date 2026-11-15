// SET-042 / SET-060 / T-037 (rest): ending every terminal session in one go from the Resource Manager,
// and the "restart the terminal service" offer. Kolux runs its terminals inside the app (no separate
// service), so both end every session that existed at the click; one opened meanwhile survives, and
// success is reported once a fresh read lists none of them. The words differ: End all keeps the
// terminals' home ready for new ones, Restart says every pane is killed and cannot be undone.
import type { SessionUsage } from "../status/resources";

export type BulkKind = "all" | "restart";
export type Bulk = { kind: BulkKind; ids: number[] };

const plural = (n: number) => `${n} terminal session${n === 1 ? "" : "s"}`;

/** The question before the batch; null when nothing is running (nothing to ask about). */
export function bulkQuestion(kind: BulkKind, ids: number[]): { label: string; text: string; confirm: string } | null {
  if (ids.length === 0) return null;
  const what = plural(ids.length);
  return kind === "all"
    ? { label: `End ${what}`, text: `End every terminal (${what})? Running agents stop. Saved files are not touched.`, confirm: "End all" }
    : { label: "Restart every terminal", text: `End every terminal (${what}) so you can start fresh? Running agents stop. Saved files are not touched. Reopen a pane for a new terminal.`, confirm: "Restart" };
}

/** Which of the ended ids a fresh read still lists (a kill that did not take). */
export const leftOver = (ids: number[], fresh: SessionUsage[] | null): number[] => (fresh === null ? ids : ids.filter((id) => fresh.some((s) => s.id === id)));

/** The toast after the batch: success once none of them is listed, else what stayed and where to look. */
export function bulkReport(kind: BulkKind, ended: number[], left: number[]): { text: string; ok: boolean } {
  if (left.length > 0) return { ok: false, text: `${plural(left.length)} did not end (${left.map((id) => `Session ${id}`).join(", ")}); the rest did. See the diag log under the profile folder.` };
  const n = plural(ended.length);
  return kind === "all"
    ? { ok: true, text: ended.length === 0 ? "No terminal session was left to end; new terminals open straight away." : `${n} ended; new terminals open straight away.` }
    : { ok: true, text: `The terminals were restarted: ${n} ended. Reopen a pane for a fresh terminal.` };
}

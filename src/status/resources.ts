// APP-054: the Resource Manager's rows. The Rust side measures every terminal session; here they
// are grouped under the workspace (worktree) folder they run in, the rest under "No worktree".
import { underDir } from "../workspaces";
import { sessionLabel } from "./manage";
import { formatMemory } from "./memory";

/** `committed` (CLI-041, T-287-b): the pagefile-backed bytes Windows charges, summed per process
 * tree on the Rust side; null when any process in the tree gave no figure (T-287-c: a partial sum
 * is never shown as the whole) or there are none. `unreadable`: how many of `processes` gave none. */
export type Usage = { bytes: number; cpu: number; processes: number; committed: number | null; unreadable?: number };
export type SessionUsage = Usage & { id: number; pid: number | null; dir: string | null };
export type Resources = { app: Usage; sessions: SessionUsage[]; free: number | null; total: number | null };
export type Row = SessionUsage & { name: string; shown: boolean };
export type Group = { label: string; dir: string | null; rows: Row[] };

const base = (dir: string) => dir.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || dir;

/** `names`: the tab name of every session shown in a pane, by terminal id. `workspaces`: the
 * workspace folders Kolux knows; a session belongs to the deepest one it runs in. `loaded`
 * (T-153-e): false while the window is still loading, so no row claims a pane either way. */
export function groupSessions(sessions: SessionUsage[], names: Record<number, string>, workspaces: string[], loaded = true): Group[] {
  const groups = new Map<string, Group>();
  const none: Group = { label: "No workspace", dir: null, rows: [] };
  for (const s of [...sessions].sort((a, b) => a.id - b.id)) {
    const row = { ...s, ...sessionLabel(s.id, names, loaded) };
    const home = workspaces.filter((w) => underDir(s.dir, w)).sort((a, b) => b.length - a.length)[0];
    if (home === undefined) {
      none.rows.push(row);
      continue;
    }
    const g = groups.get(home) ?? { label: base(home), dir: home, rows: [] };
    g.rows.push(row);
    groups.set(home, g);
  }
  return [...groups.values(), ...(none.rows.length > 0 ? [none] : [])];
}

/** T-287-b: committed memory beside resident; unknown is a plain dash, never "0 MB". */
export const formatCommitted = (committed: number | null | undefined) =>
  committed === null || committed === undefined || !Number.isFinite(committed) || committed < 0 ? "–" : formatMemory(committed);

/** MERGE 52 / council FIX-1 (T-287-c): the Rust side gives no committed figure when any process
 * could not be read, so the dash says how many were left out; "" when the dash only means there are
 * no processes, or a figure is shown. */
export const committedNote = (u: Pick<Usage, "committed" | "unreadable" | "processes">) =>
  u.committed === null && (u.unreadable ?? 0) > 0 ? `(${u.unreadable} of ${u.processes} could not be read)` : "";

/** T-287-b: the rows' columns (name, resident, committed, CPU, End), set here so the committed
 * column needs no stylesheet change. */
export const RES_COLUMNS = "minmax(0, 1fr) 72px 86px 48px 52px";

export const formatCpu = (cpu: number) => `${cpu < 10 ? cpu.toFixed(1) : Math.round(cpu)}%`;

/** VIEW-099: End skips its question only when a fresh read no longer lists the session (it has
 * ended); a failed read asks, so nothing is ever ended unasked. */
export const endNeedsAsk = (fresh: Resources | null, id: number) => fresh === null || fresh.sessions.some((s) => s.id === id);

/** usage-status.md:11: wraps an async read so a call made while the last one is still running is skipped (resolves undefined). */
export function singleFlight<T>(fn: () => Promise<T>): () => Promise<T | undefined> {
  let busy = false;
  return async () => {
    if (busy) return undefined;
    busy = true;
    try {
      return await fn();
    } finally {
      busy = false;
    }
  };
}

/** usage-status.md:8: what Escape closes in the Resource Manager: an open End question first (the Restart/End all one,
 * then a single session's, then End N's), the whole panel only when none is open. */
export function escapeStep(open: { bulk: boolean; ending: boolean; asking: boolean; background?: boolean }): "bulk" | "ending" | "asking" | "background" | "close" {
  return open.bulk ? "bulk" : open.ending ? "ending" : open.asking ? "asking" : open.background ? "background" : "close";
}

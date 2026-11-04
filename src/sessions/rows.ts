// VIEW-084 (T-127-b): what an opened session row shows, as plain data. The back end
// (session_rows.rs) reads the transcript; this is the words around it: the worktree line, the
// prompt card's label and the state of each child run.

export type Child = { id: string; title: string; running: boolean };
export type Detail = { prompt: string | null; recentPromptOnly: boolean; latest: string | null; children: Child[]; dirExists: boolean | null };

export type WorktreeState = "current" | "active" | "unavailable" | "available" | "unknown";
export type WorktreeLine = { state: WorktreeState; label: string; tip: string; jump: boolean };

const key = (p: string) => p.replace(/^\\\\\?\\/, "").replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
const last = (p: string) => p.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || p;

/** The row's worktree line: this workspace (current), another open one (active), a folder that is gone
 *  (unavailable, with the reason), or a folder that exists but is not open. Current and active jump there. */
export function worktreeLine(dir: string | null, exists: boolean | null, activeDir: string | null, openDirs: string[]): WorktreeLine {
  if (dir === null || dir.trim() === "") return { state: "unknown", label: "Folder not recorded", tip: "This session's transcript does not say which folder it ran in.", jump: false };
  const name = last(dir);
  if (exists === false) return { state: "unavailable", label: `Unavailable: ${name}`, tip: `${dir} no longer exists. The workspace may have been deleted or moved, so this session cannot be opened there.`, jump: false };
  if (activeDir !== null && key(activeDir) === key(dir)) return { state: "current", label: `Current workspace: ${name}`, tip: dir, jump: true };
  if (openDirs.some((d) => key(d) === key(dir))) return { state: "active", label: `Active workspace: ${name}`, tip: `${dir}\nClick to go there.`, jump: true };
  return { state: "available", label: `Folder: ${name}`, tip: `${dir}\nIt exists but is not open in Kolux.`, jump: false };
}

/** The prompt card's heading: when only a recent prompt could be read it says so. */
export const promptHeading = (d: Pick<Detail, "recentPromptOnly">): string => (d.recentPromptOnly ? "Recent prompt" : "First prompt");

/** A child run's state word for its dot. */
export const childState = (c: Pick<Child, "running">): "running" | "finished" => (c.running ? "running" : "finished");

/** "2 sub-agents" / "1 sub-agent" / "" for the row's one-line summary. */
export const childCount = (n: number): string => (n === 0 ? "" : `${n} sub-agent${n === 1 ? "" : "s"}`);

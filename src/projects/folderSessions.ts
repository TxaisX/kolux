// Txais (2026-11-12): the sidebar lists workspace folders and their UI sessions, never worktrees. A folder's sessions are
// the open agent and terminal panes whose folder is the workspace itself or any worktree of it: an own-folder team runs
// each agent in a worktree of its own, and those agents show as session rows under the folder they belong to.
import { underDir } from "../workspaces";
import type { AgentState } from "./rows";

export type FolderSession = { key: number; agent: string; title: string; cwd: string | null; view?: string | null; running: boolean; state?: AgentState };

/** One project's folders: its main checkout and every worktree made from it. */
export type ProjectRoots = { id: string; paths: string[] };

const depth = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "").length;

/** The project whose folder holds `dir`: the deepest root wins, so a project nested in another keeps its own sessions. */
function owner(dir: string | null | undefined, roots: ProjectRoots[]): string | null {
  if (dir == null) return null;
  let best: { id: string; len: number } | null = null;
  for (const r of roots)
    for (const p of r.paths) {
      const len = depth(p);
      if (underDir(dir, p) && (best === null || len > best.len)) best = { id: r.id, len };
    }
  return best?.id ?? null;
}

/** Each project's sessions, in the order the panes are given. A pane belongs where it runs (`cwd`), else where it is shown (`view`). */
export function sessionsByProject(sessions: FolderSession[], roots: ProjectRoots[]): Record<string, FolderSession[]> {
  const out: Record<string, FolderSession[]> = {};
  for (const s of sessions) {
    const id = owner(s.cwd, roots) ?? owner(s.view, roots);
    if (id !== null) (out[id] ??= []).push(s);
  }
  return out;
}

/** The folder a session's grid is shown in: where a click on its row goes. */
export const sessionDir = (s: { cwd: string | null; view?: string | null }): string | null => (s.view !== undefined ? s.view : s.cwd);

/** What a session row is called: the pane's tab title, else its agent. */
export const sessionLabel = (s: { title: string; agent: string }): string => (s.title.trim() !== "" ? s.title : s.agent);

/** Focuses a session's pane once its grid is drawn: the panel cannot reach the window's pane focus, so it presses the pane's own
 *  header the way a click would (a second try after a short wait, for a grid that was not on screen yet). */
export function focusPane(key: number, doc: Pick<Document, "querySelector"> | undefined = typeof document === "undefined" ? undefined : document, later: (fn: () => void, ms: number) => void = (fn, ms) => void setTimeout(fn, ms)): void {
  const press = (): boolean => {
    const el = doc?.querySelector<HTMLElement>(`section.pane[data-key="${key}"]`);
    if (!el) return false;
    el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    return true;
  };
  later(() => {
    if (!press()) later(press, 150);
  }, 0);
}

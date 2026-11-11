// EDIT-032 (T-177) / EDIT-004: the tab list's side of renames and closes. App mounts this once:
// when Explorer moves a file (fileMoved.ts), every editor, diff and preview tab on it follows to the
// new path; closing editor tabs on purpose discards their unsaved-text drafts.
import { useEffect } from "react";
import { keyOf } from "./buffers";
import { drafts, worktreeOf } from "./drafts";
import { MOVED_EVENT, movedPath, type Move } from "./fileMoved";

type TabLike = { key: number; kind?: string; path?: string; cwd?: string | null };
const FILE_TABS = new Set(["editor", "diff", "preview"]);

/** The tab list after the moves: a file tab on a moved file (or under a moved folder) gets the new path. */
export function followMoves<T extends TabLike>(panes: T[], moves: Move[]): T[] {
  let changed = false;
  const out = panes.map((p) => {
    const to = p.path && p.kind && FILE_TABS.has(p.kind) ? movedPath(p.path, moves) : null;
    if (to === null || to === p.path) return p;
    changed = true;
    return { ...p, path: to };
  });
  return changed ? out : panes;
}

/** Drops the drafts of editor tabs the user closed on purpose. A file an editor tab in `staying` still shows keeps
 *  its draft: the two tabs share one text, so the unsaved edits are still open there. */
export function discardDraftsOf(panes: TabLike[], staying: TabLike[] = []): void {
  const kept = new Set(staying.flatMap((p) => (p.kind === "editor" && p.path ? [keyOf(p.path)] : [])));
  for (const p of panes) if (p.kind === "editor" && p.path && !kept.has(keyOf(p.path))) void drafts.discard(worktreeOf(p.cwd ?? null, p.path), p.path);
}

export function useFileMoves<T extends TabLike>(setPanes: (f: (ps: T[]) => T[]) => void): void {
  useEffect(() => {
    const on = (e: Event) => setPanes((ps) => followMoves(ps, (e as CustomEvent<Move[]>).detail));
    window.addEventListener(MOVED_EVENT, on);
    return () => window.removeEventListener(MOVED_EVENT, on);
  }, [setPanes]);
}

// T-609 (brief "Path to an A", Phase 0): "Review changes" on a Board Done card and an Inbox row. It opens the
// existing review of that pane's worktree, its All Changes tab (EDIT-029); no new screen. Pure, tested here.
import { sameDir, viewOf } from "../workspaces";

/** T-609: only finished work is offered for review: a Done card (VIEW-023) and a Done today row (STAT-050). DT-C52: an
 *  Inbox row Stopped because its program exited is offered it too once its worktree is known to hold changes
 *  (`changed`, the detail's git count; null while unread). */
export const canReview = (laneOrGroup: string, changed: number | null = null): boolean => laneOrGroup === "done" || (laneOrGroup === "stopped" && (changed ?? 0) > 0);

type Tab = { key: number; cwd: string | null; view?: string | null; branch: string | null; kind?: string };

/** T-609: where the review opens for pane `key`: the All Changes tab of the same worktree in its grid comes to the
 *  front (EDIT-029 keeps one per worktree in a grid), else a new one opens in the cell right after the pane (one
 *  session per cell), on the pane's worktree and branch. Null for a pane that is gone or has no folder. */
export function reviewTab(panes: Tab[], key: number): { focus: number } | { open: { cwd: string; view?: string | null; branch: string | null; after: number } } | null {
  const p = panes.find((x) => x.key === key);
  if (!p?.cwd) return null;
  const open = panes.find((x) => x.kind === "changes" && sameDir(viewOf(x), viewOf(p)) && sameDir(x.cwd, p.cwd));
  // DT-C274: a pane shown in another folder's grid (an own-folder team) keeps that grid for its review.
  return open ? { focus: open.key } : { open: { cwd: p.cwd, ...(p.view !== undefined ? { view: p.view } : {}), branch: p.branch, after: p.key } };
}

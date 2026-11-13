// STAT-048 / T-125: the app badge counts the workspaces with agent results not yet seen. Unread tabs
// count once, under their workspace folder; a tab with no folder counts as its own; large counts
// are capped; zero clears the badge (the Rust side, badge_set, ignores a failure to set or clear).
import { sameDir, viewOf } from "../workspaces";

export const BADGE_CAP = 99;

// DT-C274: a tab counts under the folder whose grid shows it (`viewOf`), so an own-folder team counts as one workspace.
export function badgeCount(unread: Iterable<number>, panes: ReadonlyArray<{ key: number; cwd: string | null; view?: string | null }>, cap = BADGE_CAP): number {
  const dirs: (string | null)[] = [];
  let loose = 0;
  for (const k of unread) {
    const p = panes.find((x) => x.key === k);
    if (!p) continue; // a closed pane's mark is gone with it
    const at = viewOf(p);
    if (at === null) loose += 1;
    else if (!dirs.some((d) => sameDir(d, at))) dirs.push(at);
  }
  return Math.min(dirs.length + loose, cap);
}

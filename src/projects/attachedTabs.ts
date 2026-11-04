// VIEW-076 / PROJ-086: the folder workspace's Attached worktrees and PR Checks tabs, pure parts.
// A worktree made from an attached worktree, at any depth, is listed under it; the PR Checks tab
// rolls the attached worktrees' pull requests into one result, leaving out a pull request the host
// reports as unlinked (or none at all) and one that was dismissed.
import type { PrChecks } from "../scm/checks";
import { attachedTo, folderResult, type PrResult, type Worst } from "./folderWorkspace";
import type { Worktree } from "./model";

export type AttachedRow = { path: string; label: string; depth: number; branch: string | null };

/** How often the tabs ask again on their own while in view (the Refresh button asks at once). */
export const ATTACHED_REFRESH_MS = 30_000;

const key = (p: string) => p.replace(/\//g, "\\").replace(/\\+$/, "").toLowerCase();
const baseName = (p: string) => p.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || p;

/** The worktrees attached to `folder`, each child directly under the one it was made from. */
export function attachedRows(folder: string, all: Worktree[]): AttachedRow[] {
  const mine = attachedTo(folder, all) as Worktree[];
  const out: AttachedRow[] = [];
  const walk = (parent: string, depth: number) => {
    for (const w of mine.filter((x) => key(x.parent ?? "") === parent)) {
      out.push({ path: w.path, label: w.name?.trim() || w.branch || baseName(w.path), depth, branch: w.branch });
      walk(key(w.path), depth + 1);
    }
  };
  walk(key(folder), 0);
  return out;
}

/** One worktree's answer as a rollup input; undefined (left out) when it has no linked pull request. */
export function resultOfChecks(c: PrChecks | null | undefined, dismissed: ReadonlySet<number> = new Set()): PrResult | undefined {
  if (!c?.pr || c.pr.state.toLowerCase() === "unlinked") return undefined;
  return { checks: c.checks, dismissed: dismissed.has(c.pr.number) };
}

export function rollup(folder: string, all: Worktree[], answers: Record<string, PrChecks | null>, dismissed?: ReadonlySet<number>): Worst | null {
  return folderResult(folder, all, (p) => resultOfChecks(answers[p], dismissed));
}

export const rollupLine = (w: Worst | null): string =>
  w === "failing" ? "Failing: a check has failed in an attached workspace." : w === "pending" ? "Pending: checks are still running." : w === "passing" ? "Passing: every attached pull request is green." : "No attached workspace has a pull request with checks.";

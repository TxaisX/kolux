// PROJ-086: folder workspaces for projects without Git. A folder workspace shows the worst pull request
// check result among the worktrees attached to it, nested ones included (failing beats pending beats
// passing), leaving out pull requests that were dismissed; its root folder workspace cannot be deleted
// or forgotten.
import type { Check } from "../scm/checks";

export type Worst = "failing" | "pending" | "passing";
export type Attached = { path: string; parent?: string | null };

const key = (p: string) => p.replace(/\//g, "\\").replace(/\\+$/, "").toLowerCase();

/** Every worktree under `folder`, through any number of parents (a cycle in the records is cut). */
export function attachedTo(folder: string, all: Attached[]): Attached[] {
  const out: Attached[] = [];
  const seen = new Set([key(folder)]);
  let layer = [key(folder)];
  while (layer.length > 0) {
    const next: string[] = [];
    for (const w of all) {
      const k = key(w.path);
      if (!seen.has(k) && w.parent && layer.includes(key(w.parent))) {
        seen.add(k);
        out.push(w);
        next.push(k);
      }
    }
    layer = next;
  }
  return out;
}

/** One result per attached pull request: its checks and whether it was dismissed. */
export type PrResult = { checks: Pick<Check, "outcome">[]; dismissed?: boolean };

export function worstOf(results: PrResult[]): Worst | null {
  let worst: Worst | null = null;
  for (const r of results.filter((x) => !x.dismissed)) {
    for (const c of r.checks) {
      const w: Worst | null = c.outcome === "failed" || c.outcome === "unresolved" ? "failing" : c.outcome === "running" ? "pending" : c.outcome === "passed" ? "passing" : null;
      if (w === "failing") return "failing";
      if (w === "pending" || (w === "passing" && worst === null)) worst = w;
    }
  }
  return worst;
}

/** The folder workspace's own result from the results of the worktrees attached to it. */
export function folderResult(folder: string, all: Attached[], resultOf: (path: string) => PrResult | undefined): Worst | null {
  return worstOf(attachedTo(folder, all).flatMap((w) => resultOf(w.path) ?? []));
}

export const folderMissingNote = "This folder is missing on disk.";

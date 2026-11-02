// T-235-b (EDIT-030): the rules behind the CI check tab, kept apart from the screen: which tab a check
// opens in, which annotation may be opened, the card text, and when Fix with AI is on.
import { sameDir } from "../workspaces";
import type { Check } from "./checks";

/** What a check tab keeps of the check it was opened from (the Checks panel's row, plus its pull request). */
export type CheckRef = {
  /** The check run's id: the job number in the check's address. Tabs are told apart by it, never by name. */
  id: number;
  name: string;
  link: string;
  outcome: Check["outcome"];
  workflow?: string | null;
  pr: { number: number; url: string; state: string } | null;
};
export type CheckStep = { number: number; name: string; status: string; conclusion: string | null };
export type CheckAnnotation = { path: string; startLine: number; endLine: number; level: string; title: string; message: string };
export type CheckDetail = { steps: CheckStep[]; annotations: CheckAnnotation[] };

/** The check run's id in a check's address: `.../actions/runs/<run>/job/<job>` or `.../runs/<id>`. Null when it has none. */
export function checkIdOf(link: string | null | undefined): number | null {
  const m = /\/job\/(\d+)(?=$|[/?#])/.exec(link ?? "") ?? /(?<!\/actions)\/runs\/(\d+)(?=$|[/?#])/.exec(link ?? "");
  const id = m ? Number(m[1]) : 0;
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/** One tab per check per worktree: the key a check tab is known by. */
export const checkKey = (cwd: string | null, id: number): string => `${cwd ?? ""}::check:${id}`;

/** The open tab of this check in this worktree, if any: found by the check's id, so two checks with the same name never share one. */
export function findCheckPane<P extends { kind?: string; cwd: string | null; check?: { id: number } }>(panes: P[], cwd: string | null, id: number): P | undefined {
  return cwd === null ? undefined : panes.find((p) => p.kind === "check" && p.check?.id === id && sameDir(p.cwd, cwd));
}

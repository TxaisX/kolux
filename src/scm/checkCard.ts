// T-235-b (EDIT-030): the rules behind the CI check tab, kept apart from the screen: which tab a check
// opens in, which annotation may be opened, the card text, and when Fix with AI is on.
import { fixBlocker, type PrCheck } from "../tasks/prModel";
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

type Parsed = { root: string; parts: string[] };
/** A path split into its root (`C:`, `//`, `/` or none) and parts; both slashes count, `.` parts go. */
function parse(path: string): Parsed {
  const s = path.replace(/\\/g, "/");
  const drive = /^([A-Za-z]:)(?:\/|$)/.exec(s);
  const [root, rest] = drive ? [drive[1].toUpperCase(), s.slice(2)] : s.startsWith("//") ? ["//", s.slice(2)] : s.startsWith("/") ? ["/", s.slice(1)] : ["", s];
  return { root, parts: rest.split("/").filter((p) => p !== "" && p !== ".") };
}

/** Folds `..` away; null when one climbs above where the path starts. */
function folded(parts: string[]): string[] | null {
  const out: string[] = [];
  for (const p of parts) {
    if (p !== "..") out.push(p);
    else if (out.pop() === undefined) return null;
  }
  return out;
}

/**
 * The file an annotation names, as a path inside the worktree `cwd`, or null when it must not be opened:
 * a relative path is joined to the worktree (and may not climb out of it), an absolute one must already
 * be inside. Either slash, any drive-letter case; the answer uses the worktree's own spelling.
 */
export function insideWorktree(cwd: string, path: string): string | null {
  if (path.trim() === "") return null;
  const base = parse(cwd);
  const given = parse(path);
  const sep = cwd.includes("\\") ? "\\" : "/";
  const windows = base.root !== "/" && base.root !== "";
  const same = (a: string, b: string) => (windows ? a.toLowerCase() === b.toLowerCase() : a === b);
  let below: string[] | null;
  if (given.root === "") {
    below = folded(given.parts);
  } else {
    if (given.root !== base.root) return null;
    const all = folded(given.parts);
    if (all === null || all.length <= base.parts.length || !base.parts.every((p, i) => same(p, all[i]))) return null;
    below = all.slice(base.parts.length);
  }
  if (below === null || below.length === 0) return null;
  return `${cwd.replace(/[\\/]+$/, "")}${sep}${below.join(sep)}`;
}

const stepLine = (s: CheckStep) => `${s.number}. ${s.name}: ${s.conclusion ?? s.status}`;

/** The whole card as plain text, for the clipboard. */
export function cardText(c: CheckRef, d: CheckDetail | null): string {
  const lines = [`Check: ${c.name}${c.workflow ? ` (${c.workflow})` : ""}`, `Result: ${c.outcome}`];
  if (c.pr) lines.push(`Pull request: #${c.pr.number} ${c.pr.url}`);
  lines.push(`Link: ${c.link}`, "");
  if (!d) return lines.join("\n").trimEnd();
  lines.push("Steps:", ...(d.steps.length ? d.steps.map(stepLine) : ["No steps reported."]), "");
  if (d.annotations.length) {
    lines.push("Annotations:");
    for (const a of d.annotations) {
      const at = a.endLine > a.startLine ? `${a.startLine}-${a.endLine}` : `${a.startLine}`;
      lines.push(`${a.level} ${a.path}:${at}${a.title ? ` ${a.title}` : ""}: ${a.message}`);
    }
  }
  return lines.join("\n").trimEnd();
}

/** The PrCheck shape the Fix with AI rules (tasks/prModel) read. */
export function asPrCheck(c: CheckRef): PrCheck {
  const run = /\/actions\/runs\/(\d+)/.exec(c.link);
  const conclusion = c.outcome === "failed" ? "failure" : c.outcome === "passed" ? "success" : c.outcome;
  return { id: c.id, name: c.name, status: c.outcome === "running" ? "in_progress" : "completed", conclusion: c.outcome === "running" ? "" : conclusion, url: c.link, runId: run ? Number(run[1]) : null };
}

/** Why Fix with AI is off for this check, or null when it can go: it failed, its pull request is open, and the rest of GIT-051's rules. */
export function fixBlockerFor(c: CheckRef, workspace: string | null): string | null {
  if (c.outcome !== "failed") return "Only a failed check can be fixed.";
  if (!c.pr) return "This branch has no pull request.";
  if (c.pr.state.toUpperCase() !== "OPEN") return "The pull request is not open.";
  return fixBlocker(asPrCheck(c), workspace);
}

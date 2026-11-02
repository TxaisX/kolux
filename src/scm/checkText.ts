// T-235-b (EDIT-030): the card rules the CI check tab alone needs (path guard, card text, Fix with AI),
// kept out of checkCard.ts so the first-load bundle carries only the tab's identity helpers.
import { fixBlocker, type PrCheck } from "../tasks/prModel";
import type { CheckDetail, CheckRef, CheckStep } from "./checkCard";

/** One tab per check per worktree: the key a check tab is known by. */
export const checkKey = (cwd: string | null, id: number): string => `${cwd ?? ""}::check:${id}`;

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

const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
/** A path part Windows would read as the name it looks like: no drive or stream colon, no trailing dot or space, no device name (`aux.txt` too). */
const plainName = (part: string): boolean => !part.includes(":") && !/[. ]$/.test(part) && !RESERVED.test(part);

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
  if (below === null || below.length === 0 || below.some((p) => !plainName(p))) return null;
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

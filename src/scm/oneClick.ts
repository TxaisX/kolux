// GIT-022 (T-228-d): one click from unfinished work to a pull request. The run is kept here, by
// folder, outside any component, so it goes on while the user is busy in another workspace and the
// notice shows its current step on return. It stops with a specific message when the branch has
// to be synced first or changed while the text was being written.
import { useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import { writerArgs, type Writer } from "./generate";
import type { ActionOutcome, CommitOutcome, Pr, Status } from "./model";
import type { Details } from "../projects/details";
import { workItem } from "../projects/model";
import { norm } from "../status/finished";

export const STEPS = ["prepare", "message", "commit", "push", "text", "open"] as const;
export type StepId = (typeof STEPS)[number];
export const STEP_WORDS: Record<StepId, string> = {
  prepare: "Preparing the branch",
  message: "Writing a commit message",
  commit: "Committing",
  push: "Pushing the branch",
  text: "Writing the review text",
  open: "Opening the pull request",
};

/** T-653: what an automatic run (autoPr.ts) adds to a run: how its last step ended, the files a stop names, and whether the repository has no remote. */
export type AutoKind = "done" | "clean" | "local" | "skipped" | "blocked" | "failed";
/** What a back end automatic step answers: how it ended, a sentence, and the files it names (names only, never contents). */
export type AutoStep = { kind: AutoKind; message: string; files: string[] };
export type AutoInfo = { kind: AutoKind; files: string[]; local: boolean };
export type Run = { dir: string; step: StepId; state: "running" | "done" | "failed"; message: string | null; pr: Pr | null; skipped: StepId[]; push: "push" | "publish" | "force" | null; neutral?: boolean; auto?: AutoInfo };
// neutral: the flow ended on the user's own setting (AI off), not on a fault; the notice does not mark it failed.

/** The step as the notice words it: the push step says what kind of push it is. */
export const stepWord = (r: Pick<Run, "step" | "push">): string => (r.step === "push" && r.push === "publish" ? "Publishing the branch" : r.step === "push" && r.push === "force" ? "Pushing the branch (force with lease)" : STEP_WORDS[r.step]);

/** What the flow calls; the real ones are the back end commands, tests give their own. */
export type Ports = {
  status: (dir: string) => Promise<Status>;
  /** auto_pr_scan: checks every file a whole-worktree stage would add (secrets, 10 MB, heavy folders, 5,000 files); stages nothing. */
  scan: (dir: string) => Promise<AutoStep>;
  stage: (dir: string, paths: string[]) => Promise<unknown>;
  message: (dir: string) => Promise<string>;
  commit: (dir: string, message: string) => Promise<CommitOutcome>;
  remote: (dir: string, action: "push" | "publish" | "force") => Promise<ActionOutcome>;
  text: (dir: string, base: string) => Promise<[string, string]>;
  create: (dir: string, title: string, body: string, base: string) => Promise<Pr>;
};

/** GIT-024: the workspace's linked issue as the description request carries it; a pull request or free text is no issue. */
export function linkedIssue(item: string | null, name: string | null): { number: number; title: string; body: null } | null {
  const w = item ? workItem(item) : null;
  const number = w ? (w.kind === "issue" ? w.number : 0) : Number(/^#(\d+)$/.exec(item?.trim() ?? "")?.[1] ?? 0);
  return number > 0 ? { number, title: name?.trim() ?? "", body: null } : null;
}

export const realPorts =(writer: Writer, instructions = writer.instructions): Ports => ({
  status: (dir) => invoke<Status>("scm_status", { worktree: dir }),
  scan: (dir) => invoke<AutoStep>("auto_pr_scan", { worktree: dir }),
  stage: (dir, paths) => invoke("scm_stage", { worktree: dir, paths, on: true }),
  message: (dir) => invoke<string>("scm_commit_message", { worktree: dir, command: writer.mode === "custom" ? writer.command : null, instructions, ...(writer.mode === "agent" ? writerArgs(writer) : {}) }),
  commit: (dir, message) => invoke<CommitOutcome>("scm_commit", { worktree: dir, message }),
  remote: (dir, action) => invoke<ActionOutcome>("scm_remote", { worktree: dir, action }),
  text: async (dir, base) => {
    const d = await invoke<Details>("workspace_details_get", { path: dir }).catch(() => null);
    const issue = linkedIssue(d?.item ?? null, d?.name ?? null);
    return invoke<[string, string]>("scm_pr_text", { worktree: dir, base, command: writer.mode === "custom" ? writer.command : null, instructions, issue, useTemplate: true, ...(writer.mode === "agent" ? writerArgs(writer) : {}) });
  },
  create: (dir, title, body, base) => invoke<Pr>("scm_pr_create", { worktree: dir, title, body, base, draft: false }),
});

// Keyed by norm(): folders that differ only in case or slash style are one folder.
const runs = new Map<string, Run>();
const listeners = new Set<() => void>();
let version = 0;
const bump = () => {
  version++;
  listeners.forEach((l) => l());
};
const put = (r: Run) => {
  runs.set(norm(r.dir), r);
  bump();
};
export const oneClickRun = (dir: string): Run | null => runs.get(norm(dir)) ?? null;
/** T-653: the automatic flow writes its run into the same store, so it shows per folder like a one-click run. `putRun(dir, null)` forgets the folder's run. */
export const putRun = (dir: string, r: Run | null) => {
  if (r) put(r);
  else if (runs.delete(norm(dir))) bump();
};
/** Every run now kept, for the right panel's list. */
export const oneClickRuns = (): Run[] => [...runs.values()];
export const oneClickSubscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};
export const oneClickVersion = () => version;
export const dismissOneClick = (dir: string) => {
  const r = runs.get(norm(dir));
  if (r && r.state !== "running") {
    runs.delete(norm(dir));
    bump();
  }
};
export const clearOneClick = () => {
  runs.clear();
  bump();
};
/** Re-renders a component whenever any folder's run changes (the right panel's list). */
export const useOneClickAll = (): number => useSyncExternalStore(oneClickSubscribe, oneClickVersion, oneClickVersion);
/** The run for `dir`, kept up to date for a component. */
export const useOneClick = (dir: string | null): Run | null => {
  useSyncExternalStore(oneClickSubscribe, oneClickVersion);
  return dir === null ? null : oneClickRun(dir);
};

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
// The status lists stop at 1,000 entries and report the rest in `cut`; the rest still counts as work.
const dirty = (s: Status) => s.staged.length + s.changed.length + s.untracked.length + (s.cut ?? 0);

/** Why the branch cannot be taken further at all, or null. */
export function blocker(s: Status): string | null {
  if (s.operation !== null) return `A ${s.operation} is in progress: finish it first`;
  if (s.conflicts.length > 0) return "Resolve the conflicts first";
  if (s.branch === null) return "No branch checked out";
  if (s.base !== null && (s.base === s.branch || s.base === `origin/${s.branch}`)) return "Move to a feature branch first";
  if (s.base === null) return "No base branch on the remote";
  if (s.upstream !== null && !s.upstream.startsWith("origin/")) return `Fork head not supported: the branch tracks ${s.upstream}; push it to origin first`;
  return null;
}

/** The push step for a status: nothing, the first publish, a plain push, or force with lease after a rewrite. Null with a message when the branch has to be synced first. */
export function pushFor(s: Status): { action: "push" | "publish" | "force" | null } | { stop: string } {
  if (s.upstream === null) return { action: "publish" };
  if (s.behind > 0 && s.rewritten) return { action: "force" };
  if (s.behind > 0) return { stop: `Sync first: the remote has ${plural(s.behind, "commit")} this copy lacks` };
  return { action: s.ahead > 0 ? "push" : null };
}

/** Whether a click on create pull request should take the one-click path: there is something to commit or to push. */
export function needsOneClick(s: Status | null): boolean {
  if (s === null || blocker(s) !== null) return false;
  return dirty(s) > 0 || s.upstream === null || s.ahead > 0;
}

const stateOf = (s: Status) => `${s.branch}|${s.head}`;

/** Runs the whole flow for `dir`; resolves when it ended (the outcome is in the run). A second start for a folder that is already running does nothing. `ai` is the fresh AI gate (prDraft.ts startGatedOneClick): false means neither writer is called, the commit gets the plain message and the flow stops before the review text for the user to write it. */
export async function startOneClick(dir: string, ports: Ports, ai: boolean): Promise<Run> {
  const live = runs.get(norm(dir));
  if (live && live.state === "running") return live;
  let run: Run = { dir, step: "prepare", state: "running", message: null, pr: null, skipped: [], push: null };
  put(run);
  const at = (step: StepId) => put((run = { ...run, step }));
  const skip = (step: StepId) => (run = { ...run, skipped: [...run.skipped, step] });
  const stop = (message: string) => put((run = { ...run, state: "failed", message }));
  try {
    let s = await ports.status(dir);
    const why = blocker(s);
    if (why !== null) return stop(why), run;
    // An uncommitted change is committed with a written message; a clean branch skips both steps.
    if (dirty(s) > 0) {
      // A cut list names only the first entries, so a cut status stages the whole worktree ("." also takes deletions) and no file past the cut is left behind.
      const whole = (s.cut ?? 0) > 0;
      if (whole) {
        // Staging "." takes files the cut list never showed, so the back end checks them first; nothing is staged unless it says clean.
        const scan = await ports.scan(dir);
        if (scan.kind !== "clean") {
          const shown = scan.files.slice(0, 5).join(", ") + (scan.files.length > 5 ? ` and ${scan.files.length - 5} more` : "");
          return stop(`${scan.message || "The files to commit were not cleared."}${scan.files.length > 0 ? ` Files: ${shown}.` : ""}`), run;
        }
      }
      const paths = whole ? ["."] : [...s.changed, ...s.untracked].map((c) => c.path);
      if (paths.length > 0) await ports.stage(dir, paths);
      let message = `Work on ${s.branch}`;
      if (ai) {
        at("message");
        message = (await ports.message(dir).catch(() => "")).trim() || message;
      } else skip("message");
      at("commit");
      const out = await ports.commit(dir, message);
      if (out.blocked || out.id === null) return stop(`The commit did not go through: ${out.output}`), run;
    } else {
      skip("message");
      skip("commit");
    }
    at("push");
    s = await ports.status(dir);
    const again = blocker(s);
    if (again !== null) return stop(again), run;
    const push = pushFor(s);
    if ("stop" in push) return stop(push.stop), run;
    if (push.action !== null) {
      put((run = { ...run, push: push.action }));
      const out = await ports.remote(dir, push.action);
      if (!out.ok) return stop(`The push failed, so no pull request was created: ${out.output}`), run;
    } else skip("push");
    const before = stateOf(s);
    const base = (s.base ?? "").replace(/^origin\//, "");
    at("text");
    if (!ai) return put((run = { ...run, state: "failed", neutral: true, message: "AI writing is off, so no review text was written. The work is committed and pushed: open Create pull request and write the title and description yourself." })), run;
    const [title, body] = await ports.text(dir, base);
    // The text took a while: the branch must still be the one it was written for.
    const now = await ports.status(dir);
    if (stateOf(now) !== before) return stop("The branch changed while the review text was being written, so no pull request was created. Try again."), run;
    if (title.trim() === "") return stop("The review text came back without a title, so no pull request was created."), run;
    at("open");
    const pr = await ports.create(dir, title.trim(), body, base);
    put((run = { ...run, state: "done", pr, message: null }));
    return run;
  } catch (err) {
    stop(String(err));
    return run;
  }
}

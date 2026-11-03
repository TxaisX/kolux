// T-653 / T-654 (DT-C89, DT-C90, DT-C91): automatic pull requests. When an agent finishes a turn in a
// workspace, Kolux commits on the workspace's branch, pushes it and opens or updates a DRAFT pull
// request into the default branch. The guards (default branch, secrets, 10 MB, no force) live in the
// back end commands auto_pr_commit / auto_pr_push; this file orders the steps and keeps the run in the
// one-click store (oneClick.ts), so the run shows per folder. Nothing is retried on its own: a failure
// waits for the next finished turn. It loads on demand from autoPrWatch.ts, which the window itself
// loads on demand after mount.
import { invoke } from "@tauri-apps/api/core";
import { currentEnv } from "../agentstart/host";
import { readDraftGate, draftOffered } from "./prDraft";
import { writerOf } from "./generate";
import { realPorts, oneClickRun, putRun, type AutoKind, type AutoStep, type Run } from "./oneClick";
import type { Pr, Status } from "./model";
import { readReview } from "./prFind";
import { norm } from "../status/finished";

export type AutoRemote = "none" | "github" | "other";
export type { AutoKind, AutoStep };

export type AutoPorts = {
  remote: (dir: string) => Promise<AutoRemote>;
  commit: (dir: string) => Promise<AutoStep>;
  push: (dir: string) => Promise<AutoStep>;
  status: (dir: string) => Promise<Status>;
  /** The open pull request for the branch, or null. */
  find: (dir: string, s: Status) => Promise<Pr | null>;
  /** The title and description from the writer, or null when the AI gate is closed (neither writer is called). */
  write: (dir: string, base: string) => Promise<[string, string] | null>;
  create: (dir: string, title: string, body: string, base: string, draft: boolean) => Promise<Pr>;
};

export const DEFAULT_BODY = "Draft opened by Kolux after an agent turn.";

export const realAutoPorts: AutoPorts = {
  remote: (worktree) => invoke<AutoRemote>("auto_pr_remote", { worktree }),
  commit: (worktree) => invoke<AutoStep>("auto_pr_commit", { worktree }),
  push: (worktree) => invoke<AutoStep>("auto_pr_push", { worktree }),
  status: (worktree) => invoke<Status>("scm_status", { worktree }),
  find: async (dir, s) => {
    const l = (await readReview(dir, s)).lookup;
    if (l.kind === "failed") throw new Error(l.message);
    if (l.kind === "unsupported") throw new Error(`Pull requests are not available for ${l.host ?? "this repository"}`);
    return l.kind === "found" && l.pr.state === "OPEN" ? l.pr : null;
  },
  write: async (dir, base) => {
    const { settings, gate } = await readDraftGate(dir); // read fresh: a switch turned off a moment ago must hold
    return draftOffered(settings, gate.repo, gate.agents) ? realPorts(writerOf(settings)).text(dir, base) : null;
  },
  create: (worktree, title, body, base, draft) => invoke<Pr>("scm_pr_create", { worktree, title, body, base, draft, push: false }), // push: false, so this step never pushes on its own
};

/** DT-C89: whether the automatic flow runs in `dir`. The workspace's own true / false wins; otherwise the default: "github" (the missing value) is on only for a GitHub remote, "on" for every repository, "off" never. */
export function enabledFor(settings: Record<string, unknown> | null | undefined, dir: string, remote: AutoRemote): boolean {
  const auto = settings?.autoPr;
  const cfg = auto && typeof auto === "object" ? (auto as { default?: unknown; workspaces?: unknown }) : {};
  const own = cfg.workspaces && typeof cfg.workspaces === "object" ? (cfg.workspaces as Record<string, unknown>) : {};
  const key = norm(dir);
  for (const [k, v] of Object.entries(own)) if (norm(k) === key && typeof v === "boolean") return v;
  return cfg.default === "on" ? true : cfg.default === "off" ? false : remote === "github";
}

const shortName = (b: string | null) => b?.trim() || "Work in progress";

/** Runs the automatic flow for `dir` and resolves when it ended; the outcome is in the run store. A start while this folder's run is going does nothing. `remote` is what auto_pr_remote said (asked here when not given). */
export async function runAutoPr(dir: string, ports: AutoPorts, remote?: AutoRemote): Promise<Run> {
  const prev = oneClickRun(dir);
  if (prev && prev.state === "running") return prev;
  let run: Run = { dir, step: "commit", state: "running", message: null, pr: null, skipped: ["message"], push: null, auto: { kind: "clean", files: [], local: false } };
  putRun(dir, run);
  const set = (patch: Partial<Run>) => putRun(dir, (run = { ...run, ...patch }));
  const auto = (kind: AutoKind, files: string[] = [], local = run.auto?.local ?? false) => ({ kind, files, local });
  const stop = (s: AutoStep) => (set({ state: "failed", neutral: s.kind === "skipped", message: s.message, auto: auto(s.kind, s.files) }), run);
  // A turn with nothing to do leaves no trace: the folder keeps the run it had before.
  // Clean on both steps also means whatever stopped the folder before is fixed: that stopped run is dropped, not kept on show.
  const quiet = (): Run => {
    const drop = prev?.state === "failed" && prev.auto !== undefined;
    putRun(dir, drop ? null : prev);
    return (!drop && prev) || { ...run, state: "done" };
  };
  try {
    const rem = remote ?? (await ports.remote(dir));
    set({ auto: auto("clean", [], rem === "none") });
    const c = await ports.commit(dir);
    if (c.kind === "skipped" || c.kind === "blocked" || c.kind === "failed") return stop(c);
    set({ step: "push" });
    const p = await ports.push(dir);
    if (p.kind === "skipped" || p.kind === "blocked" || p.kind === "failed") return stop(p);
    if (p.kind === "local") {
      if (c.kind === "clean") return quiet();
      set({ state: "done", message: p.message || c.message || "Committed here. This repository has no remote, so nothing was pushed.", auto: auto("local", [], true), skipped: [...run.skipped, "text", "open"] });
      return run;
    }
    const pushed = p.kind === "done";
    if (rem !== "github") {
      if (!pushed && c.kind !== "done") return quiet();
      set({ state: "done", message: p.message || c.message || null, auto: auto("done"), skipped: [...run.skipped, "text", "open"] });
      return run;
    }
    // Step 3: the draft pull request, on GitHub only.
    set({ step: "text" });
    const s = await ports.status(dir);
    const open = await ports.find(dir, s).catch((err: unknown) => {
      throw new Error(`The branch is pushed, but the pull request lookup failed: ${String(err)}`);
    });
    if (open) {
      set({ state: "done", pr: open, message: null, auto: auto(pushed ? "done" : "clean"), skipped: [...run.skipped, "text", "open"] });
      return run;
    }
    if (!pushed && c.kind !== "done") return quiet();
    const base = (s.base ?? "").replace(/^origin\//, "");
    if (base === "") {
      set({ state: "failed", message: "The branch is pushed, but there is no base branch to open the pull request against.", auto: auto("failed") });
      return run;
    }
    const written = await ports.write(dir, base).catch(() => null);
    const title = written?.[0]?.trim() || shortName(s.branch);
    const body = written?.[1]?.trim() || DEFAULT_BODY;
    if (written === null) set({ skipped: [...run.skipped, "text"] });
    set({ step: "open" });
    const pr = await ports.create(dir, title, body, base, true);
    set({ state: "done", pr, message: null, auto: auto("done") });
    return run;
  } catch (err) {
    set({ state: "failed", message: String(err instanceof Error ? err.message : err), auto: auto("failed") });
    return run;
  }
}

const names = (dir: string) => dir.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || dir;

/** The sentence for a stop the user must hear about: names files, never their contents. */
export function stopNotice(run: Run): string {
  const files = run.auto?.files ?? [];
  const shown = files.slice(0, 5).join(", ") + (files.length > 5 ? ` and ${files.length - 5} more` : "");
  const msg = run.message ?? "It stopped.";
  return `Automatic pull request stopped in ${names(run.dir)}: ${msg}${files.length > 0 && !msg.includes(files[0]) ? ` Files: ${shown}.` : ""}`;
}

export type IdleDeps = {
  settings: () => Promise<Record<string, unknown> | null>;
  ports: AutoPorts;
  notice: (text: string) => void;
};
const realIdle: IdleDeps = {
  settings: () => invoke<Record<string, unknown>>("get_settings").catch(() => null),
  ports: realAutoPorts,
  notice: (text) => currentEnv()?.notify(text, true),
};

const busy = new Set<string>();

/** An agent finished a turn in `cwd` (status/finished.ts): run the flow if the settings turn it on for this folder. A stop with blocked or failed reaches the user in the notice line even with no panel open. */
export async function onAgentIdle(cwd: string, d: IdleDeps = realIdle): Promise<Run | null> {
  const key = norm(cwd);
  if (busy.has(key)) return null;
  busy.add(key);
  try {
    const settings = await d.settings();
    if (settings === null) return null;
    const remote = await d.ports.remote(cwd);
    if (!enabledFor(settings, cwd, remote)) return null;
    const run = await runAutoPr(cwd, d.ports, remote);
    if (run.state === "failed" && (run.auto?.kind === "blocked" || run.auto?.kind === "failed")) d.notice(stopNotice(run));
    return run;
  } catch {
    return null;
  } finally {
    busy.delete(key);
  }
}

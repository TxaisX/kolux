// What the live Changes tab (editor/AllChangesPane.tsx) does with git beyond reading it: stage and
// unstage, push, pull and sync. Kept apart from the component so the rules are testable without a
// page: which paths a bulk stage takes, the buttons the remote offers, what a finished action says,
// and the guard that lets only one action run at a time (a double click sends one commit).
import { remoteItems, failureTitle, type ActionOutcome, type Status } from "./model";

/** A line of the tab's notes: `bad` marks a failure. */
export type Say = { text: string; bad: boolean };

/** The backend call, injected so a test needs no Tauri. */
export type Call = <T>(cmd: string, args: Record<string, unknown>) => Promise<T>;

/** Runs one thing at a time: a second `run` while one is going returns undefined and does nothing. */
export function oneAtATime() {
  let busy = false;
  return {
    busy: () => busy,
    async run<T>(work: () => Promise<T>): Promise<T | undefined> {
      if (busy) return undefined;
      busy = true;
      try {
        return await work();
      } finally {
        busy = false;
      }
    },
  };
}

/** The paths "Stage all" takes (everything changed or new; conflicts are resolved by hand) or
 * "Unstage all" takes (everything staged), worktree-relative as scm_stage wants them. A list the
 * back end cut short (`cut` > 0) shows only some of the rows, so the whole worktree (".") is sent
 * instead. A staged rename also names its old path: unstaging only the new one would leave the
 * delete of the old one staged. */
export const bulkPaths = (s: Status | null, on: boolean): string[] => {
  if (!s) return [];
  if ((s.cut ?? 0) > 0) return ["."];
  const rows = on ? [...s.changed, ...s.untracked] : s.staged;
  return [...new Set(on ? rows.map((r) => r.path) : rows.flatMap(unstagePaths))];
};

/** The paths that unstage one staged row: a rename names its old path too. */
export const unstagePaths = (r: { path: string; from?: string | null }): string[] => (r.from ? [r.from, r.path] : [r.path]);

/** Stages (`on`) or unstages `paths`; null when it worked, else the failure to show. */
export async function stagePaths(call: Call, worktree: string, paths: string[], on: boolean): Promise<Say | null> {
  if (paths.length === 0) return null;
  try {
    await call("scm_stage", { worktree, paths, on });
    return null;
  } catch (e) {
    return { text: `${on ? "Staging" : "Unstaging"} failed: ${String(e)}`, bad: true };
  }
}

export type RemoteButton = { id: "push" | "pull" | "sync"; label: string; reason: string | null };

/** The three remote buttons with their counts; `reason` is why one waits, null when it can go. */
export const remoteButtons = (s: Status | null): RemoteButton[] => remoteItems(s).filter((i): i is RemoteButton => i.id === "push" || i.id === "pull" || i.id === "sync");

/** What a finished remote action says: done, or the kind of failure with the tail of git's output. */
export const remoteSay = (label: string, out: ActionOutcome): Say => {
  if (out.ok) return { text: `${label}: done`, bad: false };
  const tail = out.output.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(-3).join(" ");
  return { text: `${failureTitle(label, out)}${tail ? `: ${tail}` : ""}`, bad: true };
};

/** Runs push, pull or sync; the line to show either way. */
export async function runRemote(call: Call, worktree: string, action: RemoteButton["id"], label: string): Promise<Say> {
  try {
    return remoteSay(label, await call<ActionOutcome>("scm_remote", { worktree, action }));
  } catch (e) {
    return { text: `${label} failed: ${String(e)}`, bad: true };
  }
}

export const TREE_MIN = 160;
export const TREE_MAX = 640;
const TREE_STEP = 16;

/** The file tree's width after a key on its resize handle: arrows move it, Home and End go to the ends; null for any other key. */
export const treeWidthForKey = (width: number, key: string): number | null => {
  const clamp = (w: number) => Math.max(TREE_MIN, Math.min(TREE_MAX, w));
  if (key === "ArrowLeft") return clamp(width - TREE_STEP);
  if (key === "ArrowRight") return clamp(width + TREE_STEP);
  if (key === "Home") return TREE_MIN;
  if (key === "End") return TREE_MAX;
  return null;
};

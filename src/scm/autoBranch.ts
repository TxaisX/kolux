// GIT-020 (T-228-d): a workspace that starts with a placeholder branch gets a branch named after
// its first task. On by default; a profile that predates the setting counts as on until the user
// switches it off once (the switch writes both keys), and an opt-out after that is respected.
import { invoke } from "@tauri-apps/api/core";
import { writerArgs, writerOf } from "./generate";
import type { RepoRef } from "./recipes";

export const AUTO_BRANCH_KEY = "autoBranchName";
export const AUTO_BRANCH_SEEN_KEY = "autoBranchChosen";

export const autoBranchOn = (s: Record<string, unknown>): boolean => s[AUTO_BRANCH_SEEN_KEY] !== true || s[AUTO_BRANCH_KEY] !== false;
/** The settings patch for the switch: always records that the user has chosen. */
export const autoBranchPatch = (on: boolean): Record<string, unknown> => ({ [AUTO_BRANCH_KEY]: on, [AUTO_BRANCH_SEEN_KEY]: true });

export type Renamed = { renamed: boolean; branch: string; reason: string | null };

const tried = new Set<string>();

export type NamingPorts = { settings: () => Promise<Record<string, unknown>>; repo: (dir: string) => Promise<RepoRef | null> };
// The repository reader, the recipes and the closed settings are read when a branch is named, not with the window's
// first load (PKG-6: about 10 kB the first frame never uses).
const realPorts: NamingPorts = { settings: () => invoke<Record<string, unknown>>("get_settings"), repo: (dir) => import("./repoId").then((m) => m.readRepoRef(dir)) };

/**
 * Row 931: who may name the branch, under the rules of the 915 commit writer, read fresh. Global AI
 * off, this repository off (or unreadable while any is off), an unreadable settings file or a writer
 * set to off all give null: no agent runs, and the back end names the branch from the task's own words.
 */
export async function namingWriter(dir: string, ports: NamingPorts = realPorts): Promise<ReturnType<typeof writerArgs> | null> {
  const [{ CLOSED_SETTINGS }, { aiShownFor }] = await Promise.all([import("./prDraft"), import("./recipes")]);
  const settings = await ports.settings().catch(() => CLOSED_SETTINGS);
  const w = writerOf(settings);
  const repo = await ports.repo(dir).catch(() => null);
  return w.mode === "off" || !aiShownFor(settings, repo) ? null : writerArgs(w);
}

/** Names the placeholder branch of `dir` after `task`, once per folder. The back end leaves a branch that already has a name of its own, or an upstream, alone. */
export async function nameBranchFor(dir: string, task: string, settings: Record<string, unknown>, call: typeof invoke = invoke, ports: NamingPorts = realPorts): Promise<Renamed | null> {
  if (!autoBranchOn(settings) || task.trim() === "" || tried.has(dir)) return null;
  tried.add(dir);
  try {
    return await call<Renamed>("scm_name_branch", { worktree: dir, task, writer: await namingWriter(dir, ports) });
  } catch {
    return null;
  }
}

export const forgetNamed = (dir?: string) => (dir === undefined ? tried.clear() : tried.delete(dir));

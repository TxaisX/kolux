// PROJ-039 / STAT-039 (T-107-d, T-110-b): the first prompt an agent gets in a workspace names its
// branch after the work. The back end holds every guard (a Kolux-suggested name only, never a
// hand-named workspace, the main checkout, a pushed branch or one with a pull request, once per
// workspace); this side asks once per folder, remembers a failure so a later prompt may try again,
// and tells listeners what happened so the sidebar can show the result or the folder question.
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { autoBranchOn, namingWriter, type NamingPorts } from "../scm/autoBranch";
import { useEffect, useRef } from "react";

/** The Settings > Git & worktrees switch (mirrors the back end's setting key). */
export const RENAME_KEY = "renameBranches";

export type RenameAnswer = {
  renamed: boolean;
  reason: string | null;
  old: string | null;
  branch: string | null;
  name: string | null;
  tracking: string | null;
  /** STAT-039 (T-110-b): the folder's new last part, offered when the branch was renamed and folder renaming is on. */
  folder?: string | null;
};

export type RenameEvent = { dir: string; answer: RenameAnswer | null; error: string | null };

/** Both switches have to be on: T-116-b's rename switch and the branch-naming switch of GIT-020. */
export const renameOn = (s: Record<string, unknown>): boolean => s[RENAME_KEY] !== false && autoBranchOn(s);

const tried = new Set<string>();
const listeners = new Set<(e: RenameEvent) => void>();

/** Hears every rename try: the answer, or the complete output of a failed one (PROJ-039). */
export function onRename(cb: (e: RenameEvent) => void): () => void {
  listeners.add(cb);
  return () => void listeners.delete(cb);
}

/** Forgets what was tried (all, or one folder), so a workspace made again may be renamed again. */
export const forgetRename = (dir?: string) => {
  if (dir === undefined) {
    tried.clear();
  } else {
    tried.delete(dir);
  }
};

/**
 * Names the branch of `dir` after `task`, once per folder. A refused rename (the answer says why)
 * counts as tried; a failed one (Git's own error) goes to the `onRename` listeners and may be
 * tried again by a later prompt.
 */
export async function renameOnFirstPrompt(dir: string, task: string, settings: Record<string, unknown>, call: typeof invoke = invoke, ports?: NamingPorts): Promise<RenameAnswer | null> {
  if (!renameOn(settings) || task.trim() === "" || tried.has(dir)) return null;
  tried.add(dir);
  try {
    // Row 931: the same AI gate as the commit writer; closed means the task's own words name the branch.
    const answer = await call<RenameAnswer>("workspace_rename_on_first_prompt", { path: dir, task, writer: await namingWriter(dir, ports) });
    for (const cb of listeners) cb({ dir, answer, error: null });
    return answer;
  } catch (err) {
    tried.delete(dir);
    const text = String(err);
    for (const cb of listeners) cb({ dir, answer: null, error: text });
    return null;
  }
}

/** The folder a status report's prompt belongs to: the pane's own folder, or nothing when the report carries no prompt. */
export function promptTarget(payload: { paneKey?: number; prompt?: string | null }, cwdOf: (paneKey: number) => string | undefined): { dir: string; prompt: string } | null {
  const prompt = (payload.prompt ?? "").trim();
  if (!prompt || typeof payload.paneKey !== "number") return null;
  const dir = cwdOf(payload.paneKey);
  return dir ? { dir, prompt } : null;
}

/**
 * STAT-039 (T-110-b): listens to the hook stream, so the first prompt typed into an agent that was
 * started without one still names the branch. One subscription for the window's life; the pane
 * list and settings are read at the time of each report.
 */
export function useRenameOnFirstPrompt(cwdOf: (paneKey: number) => string | undefined, settings: Record<string, unknown>): void {
  const cwdRef = useRef(cwdOf);
  cwdRef.current = cwdOf;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  useEffect(() => {
    const off = listen<{ paneKey: number; prompt?: string | null }>("agent-status", (e) => {
      const t = promptTarget(e.payload, cwdRef.current);
      if (t) void renameOnFirstPrompt(t.dir, t.prompt, settingsRef.current);
    });
    return () => {
      void off.then((f) => f());
    };
  }, []);
}

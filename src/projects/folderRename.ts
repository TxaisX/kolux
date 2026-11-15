// STAT-039 (T-110-b): after the first work renamed a branch, Kolux asks before renaming the folder
// on disk to match. The offer comes with the rename's answer; the move is the back end's
// `workspace_move_folder` (git worktree move: nothing is deleted or overwritten, and a folder a
// terminal or agent still holds comes back as Git's complete error, with nothing changed).
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";
import { onRename, type RenameEvent } from "./renameOnWork";

/** The Settings > Git switch (mirrors the back end's setting key); on unless set off. */
export const RENAME_FOLDERS_KEY = "renameFolders";
export const renamesFolders = (s: Record<string, unknown>): boolean => s[RENAME_FOLDERS_KEY] !== false;

export type FolderOffer = { dir: string; folder: string; name: string };

/** Row 950: folders an orchestration worker or an automation run started in; no one is there to answer "Rename the folder too?". */
const unattended = new Set<string>();

/** Remembers a "start" notice that carries a dispatch (orchestration worker) or a run id (automation); forgets a removed folder. */
export function noteUnattendedStart(p: { kind?: string; path?: string; dispatch?: string; runId?: string }): void {
  if (!p.path) return;
  if (p.kind === "start" && (p.dispatch || p.runId)) unattended.add(p.path);
  else if (p.kind === "removed") unattended.delete(p.path);
}

/** The folder question a rename's answer asks for, or nothing (a refused rename, a failure, folder renaming off). */
export function offerFrom(e: RenameEvent): FolderOffer | null {
  const a = e.answer;
  if (!a || !a.renamed || !a.folder || unattended.has(e.dir)) return null;
  return { dir: e.dir, folder: a.folder, name: a.name ?? a.folder };
}

/** Offers wait their turn, one question at a time; a second offer for the same folder replaces the first. */
export const queueOffer = (list: FolderOffer[], offer: FolderOffer): FolderOffer[] => [...list.filter((o) => o.dir !== offer.dir), offer];

/** The folder's last part now, for the question's wording. */
export const lastPart = (dir: string): string => dir.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? dir;

/** Moves the folder; resolves to its new path, or rejects with Git's complete error. */
export const moveFolder = (dir: string, folder: string, call: typeof invoke = invoke): Promise<string> => call<string>("workspace_move_folder", { path: dir, name: folder });

/** The offers waiting for an answer, newest last, and a way to drop one. */
export function useFolderOffers(): { offer: FolderOffer | null; dismiss: (dir: string) => void } {
  const [list, setList] = useState<FolderOffer[]>([]);
  useEffect(
    () =>
      onRename((e) => {
        const o = offerFrom(e);
        if (o) setList((l) => queueOffer(l, o));
      }),
    [],
  );
  useEffect(() => {
    const off = listen<Parameters<typeof noteUnattendedStart>[0]>("cli-workspace", (e) => noteUnattendedStart(e.payload));
    return () => void off.then((f) => f()).catch(() => {});
  }, []);
  return { offer: list[0] ?? null, dismiss: (dir) => setList((l) => l.filter((o) => o.dir !== dir)) };
}

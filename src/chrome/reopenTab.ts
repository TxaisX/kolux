// T-164-b / TERM-047: Reopen Closed Tab for terminal tabs. The window (App.tsx) calls three things:
// rememberClosedPanes() where tabs are dropped, takeReopen() on Mod+Shift+T, and paneFor() +
// placement() to put the tab back. The ring itself is the terminal lane's (src/terminal/closedTabs.ts,
// newest first, ten entries); this file adds what that file leaves to the caller: the record shape and the
// "does this folder exist" answer.
import { invoke } from "@tauri-apps/api/core";
import type { Pane } from "../App";
import { pathForms, remember, reopen } from "../terminal/closedTabs";
import { sameDir, viewOf } from "../workspaces";

/** The folder check Reopen uses. Plain path_kind answers "outside" for a folder under no project, so such a tab always fell back to the shown workspace (after-list 383); folderOnly makes it say dir or missing. */
export const folderKind = (path: string): Promise<string> => invoke<string>("path_kind", { path, folderOnly: true });

/** What a closed terminal or agent tab needs to start again: where, and what it ran. */
export type ClosedPane = Pick<Pane, "branch" | "agent" | "agentId" | "program" | "args" | "env" | "title" | "word" | "view"> & {
  /** The folder; "" for a pane that belonged to no workspace. */
  cwd: string;
};

/** A tab that carries no program of its own (editor, diff, changes, launch sheet) is not remembered here. */
export function closedRecord(p: Pane): ClosedPane | null {
  if (p.kind || p.seats) return null;
  const rec: ClosedPane = { cwd: p.cwd ?? "", branch: p.branch, agent: p.agent, agentId: p.agentId, program: p.program, args: p.args, env: p.env, title: p.title, word: p.word };
  if (p.view !== undefined) rec.view = p.view; // DT-C274: a team tab comes back in its team's grid
  return rec;
}

export type Reopen = { kind: "terminal"; pane: ClosedPane } | { kind: "none" };

export type ClosedPanes = {
  /** Remember the tabs `keys` of `panes` that are being closed. */
  remember: (panes: readonly Pane[], keys: readonly number[]) => void;
  /** The newest closed tab; its folder is remapped (see closedTabs.reopen). */
  take: (kindOf: (path: string) => Promise<string>, home: string | null) => Promise<Reopen>;
  size: () => number;
};

export function createClosedPanes(): ClosedPanes {
  let ring: ClosedPane[] = [];
  return {
    remember(panes, keys) {
      for (const key of keys) {
        const p = panes.find((x) => x.key === key);
        const rec = p && closedRecord(p);
        if (!rec) continue;
        ring = remember(ring, rec);
      }
    },
    async take(kindOf, home) {
      while (ring.length) {
        const [next] = ring;
        // only a folder that is really there counts; a pane that had none stays without one
        const seen = new Set<string>();
        if (next.cwd) await Promise.all(pathForms(next.cwd).map(async (f) => ((await kindOf(f).catch(() => "missing")) === "dir" ? seen.add(f) : undefined)));
        const r = reopen(ring, (f) => seen.has(f), home ?? "");
        ring = r.ring;
        if (!r.tab) continue;
        return { kind: "terminal", pane: next.cwd ? r.tab : { ...r.tab, cwd: "" } };
      }
      return { kind: "none" };
    },
    size: () => ring.length,
  };
}

/** The window's one memory. */
export const closedPanes = createClosedPanes();

/** The pane to add: a fresh key, the old folder (null when it had none), no session, typed line or ask. */
export function paneFor(rec: ClosedPane, key: number): Pane {
  const { cwd, ...rest } = rec;
  return { ...rest, key, cwd: cwd === "" ? null : cwd };
}

/** One session per cell: the pane the tab returns beside (its cell goes right after that one): the focused pane when it
 * is in the same grid, else none (the tab takes the grid's last cell). A tab closed on purpose always comes back, so a
 * full grid grows past MAX_PANES for it (grid.ts). `dir` is the folder whose grid the tab returns to (DT-C274: `viewOf`
 * the closed tab). */
export function placement(panes: readonly Pane[], focused: number, dir: string | null): number | undefined {
  return panes.find((p) => p.key === focused && sameDir(viewOf(p), dir))?.key;
}

// T-164-b / TERM-047: Reopen Closed Tab for terminal tabs. The window (App.tsx) calls three things:
// rememberClosedPanes() where tabs are dropped, takeReopen() on Mod+Shift+T, and paneFor() +
// placement() to put the tab back. The ring itself is the terminal lane's (src/terminal/closedTabs.ts,
// newest first, ten entries); this file adds what that file leaves to the caller: the record shape, the
// "does this folder exist" answer, and the order against closed browser pages (one Mod+Shift+T
// undoes the newest close of either kind). Browser pages keep their own ring in src/browser/pages.ts.
import { invoke } from "@tauri-apps/api/core";
import type { Pane } from "../App";
import { CLOSED_MAX, pathForms, remember, reopen } from "../terminal/closedTabs";
import { cellsOf, groupOf, MAX_PANES } from "../terminal/grid";
import { panesIn, sameDir, viewOf } from "../workspaces";

/** The folder check Reopen uses. Plain path_kind answers "outside" for a folder under no project, so such a tab always fell back to the shown workspace (after-list 383); folderOnly makes it say dir or missing. */
export const folderKind = (path: string): Promise<string> => invoke<string>("path_kind", { path, folderOnly: true });

/** What a closed terminal or agent tab needs to start again: where, and what it ran. */
export type ClosedPane = Pick<Pane, "branch" | "agent" | "agentId" | "program" | "args" | "env" | "title" | "word" | "view"> & {
  /** The folder; "" for a pane that belonged to no workspace. */
  cwd: string;
};

/** A tab that carries no program of its own (browser, editor, diff, changes, launch sheet) is not remembered here. */
export function closedRecord(p: Pane): ClosedPane | null {
  if (p.kind || p.seats) return null;
  const rec: ClosedPane = { cwd: p.cwd ?? "", branch: p.branch, agent: p.agent, agentId: p.agentId, program: p.program, args: p.args, env: p.env, title: p.title, word: p.word };
  if (p.view !== undefined) rec.view = p.view; // DT-C274: a team tab comes back in its team's grid
  return rec;
}

export type Reopen = { kind: "terminal"; pane: ClosedPane } | { kind: "browser" } | { kind: "none" };

export type ClosedPanes = {
  /** Remember the tabs `keys` of `panes` that are being closed; `browser(key)` is the browser lane's own memory and says whether it kept the page. */
  remember: (panes: readonly Pane[], keys: readonly number[], browser: (key: number) => boolean) => void;
  /** The newest closed tab of either kind; a terminal tab has its folder remapped (see closedTabs.reopen). */
  take: (kindOf: (path: string) => Promise<string>, home: string | null) => Promise<Reopen>;
  size: () => number;
};

export function createClosedPanes(): ClosedPanes {
  let ring: ClosedPane[] = [];
  let order: ("terminal" | "browser")[] = []; // newest last
  const mark = (k: "terminal" | "browser") => (order = [...order, k].slice(-2 * CLOSED_MAX));
  return {
    remember(panes, keys, browser) {
      for (const key of keys) {
        if (browser(key)) {
          mark("browser");
          continue;
        }
        const p = panes.find((x) => x.key === key);
        const rec = p && closedRecord(p);
        if (!rec) continue;
        ring = remember(ring, rec);
        mark("terminal");
      }
    },
    async take(kindOf, home) {
      while (order.length) {
        const k = order[order.length - 1];
        order = order.slice(0, -1);
        if (k === "browser") return { kind: "browser" };
        const [next] = ring;
        if (!next) continue; // pushed out of the ten
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
export function paneFor(rec: ClosedPane, key: number, group?: number): Pane {
  const { cwd, ...rest } = rec;
  return { ...rest, key, cwd: cwd === "" ? null : cwd, group };
}

/** The cell the tab returns to: the focused pane's cell when it is in the same grid; a new cell of its
 * own, unless the workspace already shows the most cells it can, then the first cell. `dir` is the folder whose
 * grid the tab returns to (DT-C274: `viewOf` the closed tab). */
export function placement(panes: readonly Pane[], focused: number, dir: string | null): number | undefined {
  const here = panes.find((p) => p.key === focused && sameDir(viewOf(p), dir));
  if (here) return groupOf(here);
  const cells = cellsOf([...panesIn([...panes], dir)]);
  return cells.length >= MAX_PANES ? cells[0]?.group : undefined;
}

// Which pane is in view (TERM-118) and the layout report the command line reads (CLI-023), moved out of App.tsx
// as they were (cycle 2, the App.tsx split). Called where they sat, so the window's hook order is unchanged.
import { sameDir, viewOf } from "../workspaces";
import { tabName } from "./tabName";
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef } from "react";
import type { WindowState } from "../shell/windowStore";
import type { PaneGrid } from "./paneGrid";
import type { Screens } from "../chrome/useScreens";

export function useLayoutReport({ activeDir, board, cells, cliFailed, ptys, terminals, titles }: Pick<WindowState, "activeDir" | "cliFailed" | "ptys" | "titles"> & Pick<PaneGrid, "cells"> & Pick<Screens, "board" | "terminals">) {
  // TERM-118: a pane is in view when its workspace is in front (one session per cell: every pane of the grid shows;
  // the Board shows every pane); a finish or bell anywhere else marks pane and workspace row unread
  // and says so in the window. A desktop notification and the settings that gate it are T-026.
  const inView = (key: number) => {
    const cell = cells.find((c) => c.panes.some((p) => p.key === key));
    if (!cell) return false;
    return board || (terminals && sameDir(viewOf(cell.panes[0]), activeDir));
  };
  // CLI-023: the command line learns where each terminal sits (its worktree pane, its tab, its
  // name, whether it is in view) from this report, sent whenever that changes. One session per cell: `tab` is always 1,
  // kept so the command line's rows keep their shape.
  const layoutSent = useRef("");
  const reportLayout = () => {
    const rows: Record<string, unknown>[] = [];
    for (const c of cells) {
      const here = cells.filter((x) => sameDir(viewOf(x.panes[0]), viewOf(c.panes[0]))); // the cells of its grid (DT-C274)
      c.panes.forEach((p, i) => {
        const id = ptys.current[p.key];
        if (id !== undefined) rows.push({ handle: `term-${id}`, dir: p.cwd, view: viewOf(p), cell: here.indexOf(c) + 1, tab: i + 1, title: tabName(p, titles), custom: p.title ?? null, shown: inView(p.key), ask: p.ask ?? null });
      });
    }
    for (const [ask, error] of Object.entries(cliFailed.current)) rows.push({ ask, error });
    const sent = JSON.stringify(rows);
    if (sent === layoutSent.current) return;
    layoutSent.current = sent;
    void invoke("terminal_layout", { rows }).catch(() => undefined);
  };
  const report = useRef(reportLayout);
  report.current = reportLayout;
  useEffect(() => report.current());
  return {
    inView, report,
  };
}

export type LayoutReport = ReturnType<typeof useLayoutReport>;

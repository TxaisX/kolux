// Which pane is in view (TERM-118) and the layout report the session tab inventory reads (CLI-023, ORCH-060), moved out of App.tsx
// as they were (cycle 2, the App.tsx split). Called where they sat, so the window's hook order is unchanged.
import { sameDir, viewOf, type PaneLike } from "../workspaces";
import { tabName } from "./tabName";
import { paneInView } from "../shell/window/inView";
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef } from "react";
import type { WindowState } from "../shell/windowStore";
import type { PaneGrid } from "./paneGrid";
import type { Screens } from "../chrome/useScreens";

/** FT-1: the one in-view test, pure: the same answer the pane's `hidden` reads, zoom included (a pane in a zoomed-away cell is not in view). */
export function layoutInView<C extends { group: number; panes: PaneLike[] }>(
  cells: C[],
  activeOf: (cell: C) => number | null,
  key: number,
  w: { terminals: boolean; activeDir: string | null; zoomed: number | null },
): boolean {
  const cell = cells.find((c) => c.panes.some((p) => p.key === key));
  if (!cell) return false;
  return paneInView(cell, key, activeOf(cell), w);
}

export function useLayoutReport({ activeDir, activeOf, cells, ptys, terminals, titles, zoomed }: Pick<WindowState, "activeDir" | "ptys" | "titles"> & Pick<PaneGrid, "activeOf" | "cells" | "zoomed"> & Pick<Screens, "terminals">) {
  // TERM-118: a pane is in view when its workspace is in front and it is the tab on top; a finish or bell anywhere else marks tab, pane and workspace row unread
  // and says so in the window. A desktop notification and the settings that gate it are T-026.
  // FT-1: the same test the pane's `hidden` reads (shell/window/inView.ts), zoom included.
  const inView = (key: number) => layoutInView(cells, activeOf, key, { terminals, activeDir, zoomed });
  // CLI-023: the back end learns where each terminal sits (its worktree pane, its tab, its name,
  // whether it is in view) from this report, sent whenever that changes; session_tabs reads it.
  const layoutSent = useRef("");
  const reportLayout = () => {
    const rows: Record<string, unknown>[] = [];
    for (const c of cells) {
      const here = cells.filter((x) => sameDir(viewOf(x.panes[0]), viewOf(c.panes[0]))); // the cells of its grid (DT-C274)
      c.panes.forEach((p, i) => {
        const id = ptys.current[p.key];
        if (id !== undefined) rows.push({ handle: `term-${id}`, dir: p.cwd, view: viewOf(p), cell: here.indexOf(c) + 1, tab: i + 1, title: tabName(p, titles), custom: p.title ?? null, shown: inView(p.key) });
      });
    }
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

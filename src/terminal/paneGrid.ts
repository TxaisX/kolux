// The pane grid's layout for this render, moved out of App.tsx as it was (cycle 2, the App.tsx split): the cells
// and the ones shown (TERM-013 zoom), the dragged column and row weights and the divider drag (TERM-010/035)
// and the needs strip's sessions (TERM-029). One session per cell (2026-11-12): a cell shows its one pane.
// A plain function: it holds no hooks.
import { stripOn } from "../settings/general";
import { tidyWeights } from "../shell/tidy";
import { sameDir, viewOf } from "../workspaces";
import { DIVIDER_DONE, DRAG_ATTR, dragWeights, gapAt, tracks } from "./dividers";
import { cellsOf, columnsFor, rowsFor, zoomedGroup } from "./grid";
import { waitingInGrid } from "./tabs";
import type { WindowState } from "../shell/windowStore";
import type { Screens } from "../chrome/useScreens";

export function paneGrid({ activeDir, dragRef, panes, setWeights, settings, stacked, statusOf, terminals, weights, zoom }: Pick<WindowState, "activeDir" | "dragRef" | "panes" | "setWeights" | "settings" | "stacked" | "statusOf" | "weights" | "zoom"> & Pick<Screens, "terminals">) {
  const cells = cellsOf(panes);
  const shown = cells.filter((c) => sameDir(viewOf(c.panes[0]), activeDir)); // DT-C274: by the grid a cell is shown in
  const zoomed = terminals ? zoomedGroup(zoom, shown.map((c) => c.group)) : null;
  const gridCount = zoomed === null ? shown.length : 1;
  // TERM-010: the grid's column and row weights, even until a divider is dragged; a drag starts on
  // the grid's own gap, the grid takes the pointer so a release outside the window still ends it,
  // and the end is announced so panes send their program the final size once.
  const gridCols = columnsFor(gridCount, stacked[activeDir ?? ""]);
  const gridRows = rowsFor(gridCount, stacked[activeDir ?? ""]);
  const weightKey = (axis: "col" | "row") => `${activeDir ?? ""}|${axis}|${axis === "col" ? gridCols : gridRows}`;
  const weightsOf = (axis: "col" | "row") => weights[weightKey(axis)] ?? Array<number>(axis === "col" ? gridCols : gridRows).fill(1);
  // TERM-035: Equalize drops the dragged weights of this folder's grid, so every column and row is the same size again.
  // TERM-008: Equalize also tidies: every dragged size of this folder goes, whatever the pane count was when it was dragged.
  const equalizePanes = () => setWeights((w) => tidyWeights(w, activeDir ?? null));
  const gapUnder = (g: HTMLElement, x: number, y: number) => {
    const rects = [...g.querySelectorAll<HTMLElement>(":scope > .cell:not([hidden])")].map((c) => c.getBoundingClientRect());
    const cols = tracks(rects, "x");
    const rows = tracks(rects, "y");
    const gap = gapAt(x, y, cols, rows);
    return gap && { gap, px: (gap.axis === "col" ? cols : rows).reduce((a, t) => a + t.end - t.start, 0) };
  };
  const onDividerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!terminals || e.target !== e.currentTarget || e.button !== 0) return;
    const hit = gapUnder(e.currentTarget, e.clientX, e.clientY);
    if (!hit) return;
    dragRef.current = { gap: hit.gap, at: hit.gap.axis === "col" ? e.clientX : e.clientY, start: weightsOf(hit.gap.axis), px: hit.px };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // a synthetic pointer has nothing to capture
    }
    document.documentElement.setAttribute(DRAG_ATTR, hit.gap.axis);
    e.preventDefault();
  };
  const onDividerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d) {
      if (terminals && e.target === e.currentTarget) {
        const hit = gapUnder(e.currentTarget, e.clientX, e.clientY);
        e.currentTarget.style.cursor = hit ? `${hit.gap.axis}-resize` : "";
      }
      return;
    }
    const now = d.gap.axis === "col" ? e.clientX : e.clientY;
    setWeights((w) => ({ ...w, [weightKey(d.gap.axis)]: dragWeights(d.start, d.gap.i, now - d.at, d.px) }));
  };
  const endDividerDrag = () => {
    if (!dragRef.current) return;
    dragRef.current = null;
    document.documentElement.removeAttribute(DRAG_ATTR);
    window.dispatchEvent(new Event(DIVIDER_DONE));
  };
  // TERM-029: this grid's sessions waiting on a permission or a question, in grid order.
  const waiting = stripOn(settings) ? waitingInGrid(shown.flatMap((c) => c.panes.map((p) => p.key)), Object.fromEntries(panes.map((p) => [p.key, statusOf(p)]))).map((k) => panes.find((p) => p.key === k)!) : [];
  return {
    cells, shown, zoomed, gridCount, gridCols, gridRows, weightKey, weightsOf, equalizePanes, gapUnder, onDividerDown, onDividerMove,
    endDividerDrag, waiting,
  };
}

export type PaneGrid = ReturnType<typeof paneGrid>;

// FT-1 (review 0.2.0): one answer to "is this pane on screen", read by the pane's `hidden` (Pane.tsx) and by the
// window's in-view test (terminal/useLayoutReport.ts). A pane is on screen when the terminals screen is shown, its
// cell belongs to the folder in front (the cell's first pane decides, as Grid.tsx does), it is the cell's top tab,
// and zoom does not hide its cell.
import { sameDir, viewOf, type PaneLike } from "../../workspaces";

export function paneInView(
  cell: { group: number; panes: PaneLike[] } | undefined,
  key: number,
  top: number | null,
  w: { terminals: boolean; activeDir: string | null; zoomed: number | null },
): boolean {
  if (!cell || cell.panes.length === 0) return false;
  return w.terminals && top === key && sameDir(viewOf(cell.panes[0]), w.activeDir) && (w.zoomed === null || cell.group === w.zoomed);
}

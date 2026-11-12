// PROJ-048: a workspace row dropped on the middle of another row becomes its child; the edges still reorder.
import { parentChoices, type Worktree } from "./model";
import { sameDir } from "../workspaces";

export type DropBand = "above" | "parent" | "below";

/** The top quarter of a row is "above", the bottom quarter "below", the middle half takes a parent drop. */
export function dropBand(offsetY: number, height: number): DropBand {
  if (!(height > 0)) return "below";
  const f = offsetY / height;
  return f < 0.25 ? "above" : f > 0.75 ? "below" : "parent";
}

const same = sameDir;

/**
 * The new parent for `dragged` when it is dropped on `target`'s middle band, else null (the drop
 * then reorders). Never itself, one of its own descendants (a loop), the main checkout, or the
 * parent it already has; those are the same rules as the Move to picker.
 */
export function parentDropTarget(all: Worktree[], dragged: string, target: string, band: DropBand): Worktree | null {
  if (band !== "parent") return null;
  const w = all.find((x) => same(x.path, dragged));
  if (!w || w.isMain) return null;
  return parentChoices(all, w).find((x) => same(x.path, target)) ?? null;
}

/** T-186-b: a middle drop of several workspaces (the Board's selection): each one that may nest under `target`, by the path the back end knows it by. */
export function parentDropMoves(all: Worktree[], dragged: string[], target: string, band: DropBand): { path: string; parent: string }[] {
  return dragged.flatMap((d) => {
    const into = parentDropTarget(all, d, target, band);
    const w = into && all.find((x) => same(x.path, d));
    return into && w ? [{ path: w.path, parent: into.path }] : [];
  });
}

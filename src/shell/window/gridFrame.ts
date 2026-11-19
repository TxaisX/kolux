// TERM-013 / VIEW-026: the pane grid's frame, moved out of the grid's drawing: which look it wears
// (Board's lanes, the Agents screen, or the terminal grid with a zoomed cell and Classic) and when it
// is hidden behind a page or an empty Agents screen. Pure; the grid applies it.
export type GridFrame = { className: string; hidden: boolean };

/** The class and the hidden flag for the screen in front. `selected` is the Agents rail's pick. */
export function gridFrame({ board, zoomed, classic, terminals, pageOpen }: {
  board: boolean;
  zoomed: number | null;
  classic: boolean;
  terminals: boolean;
  pageOpen: boolean;
}): GridFrame {
  return {
    className: board ? "board" : `grid${zoomed === null ? "" : " zoomed"}${classic ? " classic" : ""}`,
    // T-142 / VIEW-011: the grid stays mounted (hidden) behind a page, and behind an empty Agents screen.
    hidden: (!terminals && !board) || (terminals && pageOpen),
  };
}

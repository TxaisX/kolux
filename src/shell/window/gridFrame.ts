// TERM-013 / VIEW-026: the pane grid's frame, moved out of the grid's drawing: which look it wears
// (the Agents screen, or the terminal grid with a zoomed cell and Classic) and when it
// is hidden off the Terminals screen. Pure; the grid applies it.
export type GridFrame = { className: string; hidden: boolean };

/** The class and the hidden flag for the screen in front. `selected` is the Agents rail's pick. */
export function gridFrame({ zoomed, classic, terminals }: {
  zoomed: number | null;
  classic: boolean;
  terminals: boolean;
}): GridFrame {
  return {
    className: `grid${zoomed === null ? "" : " zoomed"}${classic ? " classic" : ""}`,
    // T-142: the grid stays mounted (hidden) off the Terminals screen.
    hidden: !terminals,
  };
}

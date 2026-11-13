// TERM-008: tidy the grid. Pure; the window applies the result. (TERM-016's Move to Tab, which folded a pane into its
// neighbour's tab strip, went with the strip: one session per cell, owner decision 2026-11-12.)

/**
 * TERM-008: drops every dragged column and row weight of one folder's grid, whatever the pane count was when it was dragged,
 * so each pane in a row is the same width again. Only sizes: panes are never closed, restarted or reordered.
 * Weight keys read `${dir}|${axis}|${count}`; other folders keep theirs.
 */
export function tidyWeights(weights: Record<string, number[]>, dir: string | null): Record<string, number[]> {
  const prefix = `${dir ?? ""}|`;
  return Object.fromEntries(Object.entries(weights).filter(([k]) => !k.startsWith(prefix)));
}

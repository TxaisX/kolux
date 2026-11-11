// TERM-010: dragging the line between panes. The grid's gap is the divider; these are the pure
// parts: the column and row tracks from the visible cells' edges, the divider under a point, and
// the weights after a move. The window side (App) holds the pointer and the weights.
export type Track = { start: number; end: number };
export type Gap = { axis: "col" | "row"; i: number };
type Rect = { left: number; top: number; right: number; bottom: number };

/** The root attribute set while a divider is dragged; panes hold their program's resize until it clears. */
export const DRAG_ATTR = "data-divider";
/** Fired on the window when a drag ends, so every pane sends the program its final size once. */
export const DIVIDER_DONE = "kolux-divider-done";
export const dragging = (): boolean => document.documentElement.hasAttribute(DRAG_ATTR);

/** One track per distinct start along the axis, spanning to the farthest end of its cells. */
export function tracks(rects: Rect[], axis: "x" | "y"): Track[] {
  const seen = new Map<number, Track>();
  for (const r of rects) {
    const start = axis === "x" ? r.left : r.top;
    const end = axis === "x" ? r.right : r.bottom;
    const t = seen.get(start);
    if (t) t.end = Math.max(t.end, end);
    else seen.set(start, { start, end });
  }
  return [...seen.values()].sort((a, b) => a.start - b.start);
}

const between = (v: number, ts: Track[]): number => ts.findIndex((t, i) => i + 1 < ts.length && v > t.end && v < ts[i + 1].start);

/** The divider under a point: the column gap it sits in, else the row gap, else none. */
export function gapAt(x: number, y: number, cols: Track[], rows: Track[]): Gap | null {
  const c = between(x, cols);
  if (c >= 0) return { axis: "col", i: c };
  const r = between(y, rows);
  if (r >= 0) return { axis: "row", i: r };
  return null;
}

const round = (n: number) => Math.round(n * 1000) / 1000;

/** The weights after divider `i` moved `delta` px, with `px` the tracks' total length: weight moves
 *  between the two tracks it sits between, the sum holds, and neither goes under `min` px. */
export function dragWeights(w: number[], i: number, delta: number, px: number, min = 120): number[] {
  if (px <= 0 || i < 0 || i + 1 >= w.length) return w;
  const unit = px / w.reduce((a, b) => a + b, 0);
  const pair = w[i] + w[i + 1];
  // a window so small the two tracks hold less than 2 * min px: they meet in the middle, never below zero
  const floor = Math.min(min / unit, pair / 2);
  const a = Math.min(Math.max(w[i] + delta / unit, floor), Math.max(floor, pair - floor));
  const out = [...w];
  out[i] = round(a);
  out[i + 1] = round(pair - a);
  return out;
}

/** The grid template for the weights: one flexible track each, free to shrink to nothing. */
export const templateOf = (w: number[]): string => w.map((x) => `minmax(0, ${x}fr)`).join(" ");

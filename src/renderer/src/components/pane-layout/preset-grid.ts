/**
 * Pure pane-grid geometry — no React, no store access.
 *
 * Given a pane count, computes a near-square row layout: each row's column
 * count differs from every other row by at most one, so every row is fully
 * packed (no ragged/half-empty trailing row) while the whole grid stays as
 * close to square as the pane count allows.
 */

/** Pane counts the BridgeSpace-style workspace templates document as presets. */
export const DOCUMENTED_PRESET_COUNTS = [1, 2, 4, 6, 8, 10, 12, 14, 16] as const

/**
 * Returns column counts per row, top to bottom, summing to `paneCount`.
 * e.g. computeGridRows(8) -> [3, 3, 2] (3 rows; no row left short by more
 * than one pane relative to the others).
 */
export function computeGridRows(paneCount: number): number[] {
  const n = Math.max(1, Math.floor(paneCount))
  const rows = Math.max(1, Math.round(Math.sqrt(n)))
  const base = Math.floor(n / rows)
  const remainder = n % rows
  // Why: the first `remainder` rows absorb the extra pane each, so widths
  // only ever differ by one — never a lone straggler alone on its own row.
  return Array.from({ length: rows }, (_, i) => (i < remainder ? base + 1 : base))
}

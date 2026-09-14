/** Terminal font size that keeps a busy tile legible as the grid fills up. */
export function agentGridFontSize(tileCount: number): number {
  if (tileCount <= 2) {
    return 14
  }
  if (tileCount <= 4) {
    return 12
  }
  return 11
}

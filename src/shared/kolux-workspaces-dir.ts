// fork: KOLUX_WORKSPACES_DIR overrides the stock <home>/kolux/workspaces worktree root so worktrees
// can live off C: without hardcoding a drive in source. Safe in the renderer (no process there).
export function koluxWorkspacesDirOverride(): string | undefined {
  if (typeof process === 'undefined') {
    return undefined
  }
  const value = process.env.KOLUX_WORKSPACES_DIR?.trim()
  return value ? value : undefined
}

/** Owner change 2026-11-05: Kolux works in one folder per project. Worktree creation is off, so
 *  every surface that would make a second folder renders nothing. */
export const SINGLE_FOLDER = true;

/** T-798 (P4B-01): the commands that make, rename or delete a worktree. While worktrees are off their key chords
 *  say so and their palette rows are not listed, so no chord opens a sidebar form that is hidden. */
export const WORKTREE_COMMANDS: ReadonlySet<string> = new Set(["workspace.create", "workspace.rename", "workspace.delete"]);
export const WORKTREES_OFF = "Worktrees are off. Kolux works in the project's own folder.";
/** The line a worktree command says instead of acting, or null when it may run. */
export const worktreesOffNote = (id: string, off: boolean = SINGLE_FOLDER): string | null => (off && WORKTREE_COMMANDS.has(id) ? WORKTREES_OFF : null);
/** T-798 (P4B-01, review fix): the name the workspace palette would create from its typed text, or null.
 *  While worktrees are off there is no create row, so Enter on typed text with no match never makes one. */
export const paletteCreateName = (query: string, off: boolean = SINGLE_FOLDER): string | null => {
  const t = query.trim();
  return t !== "" && !off ? t : null;
};

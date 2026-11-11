/** Owner change 2026-11-05: Kolux works in one folder per project. Worktree creation is off, so
 *  every surface that would make a second folder renders nothing.
 *  DT-C250 (2026-11-10): that is the default, and a person can choose the other way: with "Own folder
 *  for each agent" on (Settings > Git & worktrees), an agent launched beside others gets a Git worktree
 *  of its own on its own branch, and the sidebar lists those folders again.
 *  DT-C273 (2026-11-11): own folders are now the default; only a saved `false` keeps one folder per project. */
export const OWN_FOLDERS_FIELD = "agentOwnFolders";
/** DT-C273: on unless the setting is saved as `false`. */
export const ownFoldersOn = (settings: Record<string, unknown>): boolean => settings[OWN_FOLDERS_FIELD] !== false;
let own = true;
/** The window hands over its settings each time they change. */
export const setOwnFolders = (settings: Record<string, unknown>): void => {
  own = ownFoldersOn(settings);
};
/** Whether Kolux works in one folder per project (on only when "Own folder for each agent" is turned off). */
export const singleFolder = (): boolean => !own;

/** T-798 (P4B-01): the commands that make, rename or delete a worktree. While worktrees are off their key chords
 *  say so and their palette rows are not listed, so no chord opens a sidebar form that is hidden. */
export const WORKTREE_COMMANDS: ReadonlySet<string> = new Set(["workspace.create", "workspace.rename", "workspace.delete"]);
export const WORKTREES_OFF = "Worktrees are off. Kolux works in the project's own folder.";
/** The line a worktree command says instead of acting, or null when it may run. */
export const worktreesOffNote = (id: string, off: boolean = singleFolder()): string | null => (off && WORKTREE_COMMANDS.has(id) ? WORKTREES_OFF : null);
/** T-798 (P4B-01, review fix): the name the workspace palette would create from its typed text, or null.
 *  While worktrees are off there is no create row, so Enter on typed text with no match never makes one. */
export const paletteCreateName = (query: string, off: boolean = singleFolder()): string | null => {
  const t = query.trim();
  return t !== "" && !off ? t : null;
};

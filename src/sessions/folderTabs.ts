// VIEW-057 (T-146-g): which tabs the right sidebar offers where. A workspace in a Git repository gets
// Explorer, Insights (T-646, app-wide), Checks and Agents; a folder workspace (a project without Git) has no
// git tabs and gets Attached worktrees and PR Checks instead (both get Insights, which is app-wide). The tab remembered for the window is
// used when it is offered here, else the first one offered; a folder workspace's remembered PR Checks
// wins over the window's tab. Search waits on the file-content search (T-236).
import type { Worktree } from "../projects/model";

export type TabId = "explorer" | "insights" | "checks" | "agents" | "attached" | "prchecks";

export const GIT_TABS: TabId[] = ["explorer", "insights", "checks", "agents"];
export const FOLDER_TABS: TabId[] = ["explorer", "insights", "attached", "prchecks", "agents"];
/** The settings key holding {folder: "prchecks"} for the folder workspaces whose PR Checks was left open. */
export const FOLDER_TAB_KEY = "folderWorkspaceTabs";

const key = (p: string) => p.replace(/\//g, "\\").replace(/\\+$/, "").toLowerCase();

/** A folder workspace is the one workspace of a project without Git: its main folder, no branch and no commit. */
export function isFolderWorkspace(dir: string | null, worktrees: Worktree[]): boolean {
  if (dir === null) return false;
  const w = worktrees.find((x) => key(x.path) === key(dir));
  return w !== undefined && w.isMain && w.branch === null && w.head === "";
}

export const offeredTabs = (folder: boolean): TabId[] => (folder ? FOLDER_TABS : GIT_TABS);

/** The folders whose PR Checks was left open, from the saved setting (anything else reads as none). */
export function readFolderTabs(saved: unknown): Record<string, "prchecks"> {
  const out: Record<string, "prchecks"> = {};
  if (typeof saved !== "object" || saved === null || Array.isArray(saved)) return out;
  for (const [dir, tab] of Object.entries(saved)) if (tab === "prchecks" && dir.trim() !== "") out[key(dir)] = "prchecks";
  return out;
}

/** The tab to show: a folder workspace's remembered PR Checks, else the window's tab when offered, else the first offered. */
export function tabFor(saved: unknown, dir: string | null, windowTab: TabId, offered: TabId[]): TabId {
  if (dir !== null && offered.includes("prchecks") && readFolderTabs(saved)[key(dir)] === "prchecks") return "prchecks";
  return offered.includes(windowTab) ? windowTab : (offered[0] ?? "explorer");
}

/** What to save after a tab is chosen in a folder workspace: PR Checks is remembered for that folder, any other tab forgets it. */
export function rememberTab(saved: unknown, dir: string, tab: TabId): Record<string, "prchecks"> {
  const next = readFolderTabs(saved);
  if (tab === "prchecks") next[key(dir)] = "prchecks";
  else delete next[key(dir)];
  return next;
}

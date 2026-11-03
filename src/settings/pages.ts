// SET-006: the eleven Settings pages, one small page per repository, and links that open Settings at a
// chosen page and section from anywhere in the app.

export const PAGES = {
  general: "General",
  appearance: "Appearance",
  accounts: "Accounts & keys",
  agents: "Agents",
  terminal: "Terminal & sessions",
  git: "Git & worktrees",
  safety: "Safety",
  notifications: "Notifications",
  shortcuts: "Shortcuts",
  usage: "Usage",
  claude: "Claude",
} as const;
export type PageId = keyof typeof PAGES;
export type Page = PageId | `repo:${string}`;
export type SettingsTarget = { page: Page; section?: string };

/** The window listens for this and opens Settings at `detail` (a SettingsTarget). */
export const OPEN_SETTINGS = "kolux-open-settings";
export function openSettings(page: Page, section?: string): void {
  window.dispatchEvent(new CustomEvent<SettingsTarget>(OPEN_SETTINGS, { detail: { page, section } }));
}

/** A page that exists: one of the eleven, or a repository still in the list; anything else is the first. */
export function pageOf(p: unknown, repoIds: string[]): Page {
  if (typeof p !== "string") return "general";
  if (p in PAGES) return p as PageId;
  if (p.startsWith("repo:") && repoIds.includes(p.slice(5))) return p as Page;
  return "general";
}

const LAST_KEY = "kolux.settingsPage";
/** The page Settings showed last (kept in this window's storage; the first page when there is none). */
export function lastPage(): string | null {
  try {
    return localStorage.getItem(LAST_KEY);
  } catch {
    return null;
  }
}
export function rememberPage(p: Page): void {
  try {
    localStorage.setItem(LAST_KEY, p);
  } catch {
    /* no storage: Settings opens on the first page next time */
  }
}

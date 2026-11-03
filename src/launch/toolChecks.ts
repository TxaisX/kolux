// APP-023: which tool notices the landing screen shows. Git problems always count; GitHub's and
// GitLab's programs only once a project hosted there exists. A probe that hung reads "unknown" and
// shows nothing. A dismissal holds while the set of GitHub projects is the one it was made under.
export type Check = "ok" | "missing" | "unknown";
export type Tools = {
  git: Check;
  gh: Check;
  /** "missing" here means installed but signed out. */
  ghSignedIn: Check;
  glab: Check;
  githubProjects: string[];
  gitlabProjects: string[];
  dismissed: Record<string, string>;
};
/** `action: "settings"` adds an Open Settings button (Settings > Accounts, where an AI program is connected or installed). */
export type Notice = { id: string; text: string; action?: "settings" };

/** UX audit F2: shown when the tool probe itself could not run, so the screen is never silently empty. */
export const CHECK_FAILED: Notice = { id: "check-failed", text: "Kolux could not check which tools are installed. Try again." };

/** The GitHub project set a dismissal is recorded under. */
export const dismissKey = (t: Tools) => t.githubProjects.join(",");

/** `agents` is whether any AI program is installed; null while that is still being read. */
export function toolNotices(t: Tools, agents: boolean | null): Notice[] {
  const github = t.githubProjects.length > 0;
  const list: Notice[] = [];
  if (t.git === "missing") list.push({ id: "git", text: "Git is not installed, so projects cannot be added or opened. Install it from git-scm.com, then check again." });
  if (github && t.gh === "missing") list.push({ id: "gh", text: "GitHub's gh program is not installed. Kolux uses it for pull requests and issues on your GitHub projects." });
  if (github && t.gh === "ok" && t.ghSignedIn === "missing") list.push({ id: "gh-signin", text: "GitHub's gh program is not signed in. Run gh auth login in a terminal, then check again." });
  if (t.gitlabProjects.length > 0 && t.glab === "missing") list.push({ id: "glab", text: "GitLab's glab program is not installed or does not start. Kolux uses it for merge requests on your GitLab projects." });
  if (agents === false) list.push({ id: "agents", text: "No AI program found on this computer. Install one, such as Claude Code or Codex, then check again.", action: "settings" });
  const key = dismissKey(t);
  return list.filter((n) => t.dismissed[n.id] !== key);
}

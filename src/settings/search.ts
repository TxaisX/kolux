// SET-007: searching every Settings page at once. Pages load lazily, so the search runs on this
// index rather than on the drawn pages: each section names its page, its title and everyday
// words, so a plain term finds a technical setting. The drift test checks every section here is
// still drawn as `data-section` on its page.
import { createContext } from "react";
import { agents } from "../keys/actions";
import { LANGUAGES } from "../language";
import { PAGES, type PageId } from "./pages";

export type Entry = { page: PageId; section: string; title: string; words: string; fold?: string; parent?: string };

export const INDEX: Entry[] = [
  { page: "general", section: "views", title: "Look and first screen", words: "start open launch home new classic look startup" },
  { page: "general", section: "confirmations", title: "Confirmations", words: "confirm confirmation ask again dont skipped prompt delete automation warning" },
  { page: "general", section: "editor", title: "Editor and diffs", words: "editor auto save autosave minimap word wrap spellcheck spelling diff inline split side whitespace file tree" },
  { page: "general", section: "open-in", title: "Open in", words: "open in outside external app apps editor vscode code cursor zed explorer" },
  { page: "general", section: "diagnostics", title: "Diagnostics", words: "diagnostics log copy report problem bug support crash" },
  { page: "general", section: "privacy", title: "Privacy", words: "privacy data telemetry network connections offline feedback" },
  { page: "general", section: "links", title: "Links", words: "links url open browser kolux system" },
  { page: "general", section: "cli", title: "Command line", words: "command line cli kolux shell command install path register" },
  { page: "general", section: "proxy", title: "Network proxy", words: "proxy network http https socks bypass firewall corporate http1" },
  { page: "appearance", section: "language", title: "Language", words: "locale translate " + LANGUAGES.map((l) => l.name).join(" "), fold: "interface" },
  { page: "appearance", section: "interface", title: "Mode", words: "dark light system night day theme", fold: "interface" },
  { page: "appearance", section: "zoom", title: "Zoom", words: "size bigger smaller scale text larger magnify", fold: "interface" },
  { page: "appearance", section: "theme", title: "Colour theme", words: "color colors accent palette contrast hue swatch", fold: "interface" },
  { page: "appearance", section: "custom-themes", title: "Custom themes", words: "custom theme themes create edit import export colour color", fold: "interface", parent: "theme" },
  { page: "appearance", section: "fonts", title: "Fonts", words: "font typeface app editor family text", fold: "interface" },
  { page: "appearance", section: "terminal-font", title: "Terminal font", words: "terminal font size typeface family weight", fold: "terminal" },
  { page: "appearance", section: "terminal-colours", title: "Terminal colours", words: "terminal color colors scheme ansi console import warp ghostty", fold: "terminal" },
  { page: "appearance", section: "panes", title: "Panes", words: "pane border focus dim split tabs", fold: "terminal" },
  { page: "appearance", section: "window-items", title: "Title bar and sidebar", words: "window sidebar title bar buttons hide show automations", fold: "window" },
  { page: "appearance", section: "sidebar-look", title: "Left sidebar look", words: "sidebar left tint tinted colour color match terminal background wash strength", fold: "window" },
  { page: "appearance", section: "card-density", title: "Workspace cards", words: "workspace card layout default compact detailed custom details density pinned pull request note", fold: "window" },
  { page: "appearance", section: "status-bar", title: "Status bar", words: "status bar bottom items", fold: "window" },
  // ACCT-030: each provider is its own section (parent = the section it is drawn inside), so a search for one
  // provider word leaves only that provider's card and accounts; a word of the wrapper itself keeps all of it.
  { page: "accounts", section: "connections", title: "AI connections", words: "connect sign in login key api token account plan" },
  { page: "accounts", section: "connect-claude", parent: "connections", title: "Claude", words: "claude anthropic sign in login subscription pro max 1-year key token" },
  { page: "accounts", section: "connect-codex", parent: "connections", title: "Codex", words: "codex openai chatgpt sign in login plan api key" },
  { page: "accounts", section: "connect-grok", parent: "connections", title: "Grok", words: "grok xai api key" },
  { page: "accounts", section: "accounts-advanced", title: "Manage accounts (advanced)", words: "accounts switch several multiple advanced" },
  { page: "accounts", section: "accounts-claude", parent: "accounts-advanced", title: "Claude accounts", words: "claude anthropic accounts managed switch several multiple" },
  { page: "accounts", section: "accounts-codex", parent: "accounts-advanced", title: "Codex accounts", words: "codex openai chatgpt accounts managed switch several multiple" },
  { page: "accounts", section: "agent-folders", parent: "accounts-advanced", title: "Agent folders and credentials", words: "agent folders credentials sessions config home" },
  { page: "accounts", section: "provider-usage", title: "Provider usage", words: "provider usage limits quota plan balance remaining", parent: "accounts-advanced" },
  { page: "accounts", section: "minimax", parent: "agent-folders", title: "MiniMax", words: "minimax cookie session api key" },
  { page: "accounts", section: "gemini", parent: "agent-folders", title: "Gemini", words: "gemini google api key" },
  { page: "agents", section: "default", title: "Default agent", words: "default agent new tab start" },
  { page: "agents", section: "hooks", title: "Agent status hooks", words: "hooks status working waiting finish tell kolux" },
  { page: "agents", section: "seat-default", title: "Default model and effort", words: "default model effort seat reasoning" },
  { page: "agents", section: "permissions", title: "Agent Permissions", words: "permission allow approve yolo skip ask safety" },
  { page: "agents", section: "agents", title: "Installed agents", words: "installed install cli programs " + agents.map(([id, name]) => `${id} ${name}`).join(" ") },
  { page: "terminal", section: "panes", title: "New workspaces start with", words: "panes grid workspace start count layout" },
  { page: "terminal", section: "text", title: "Terminal text and cursor", words: "terminal font size family typeface weight bold line height spacing cursor caret blink block bar underline contrast readable sample" },
  { page: "terminal", section: "scrolling", title: "History and scrolling", words: "scrollback history rows lines buffer scroll sensitivity speed fast wheel" },
  { page: "terminal", section: "clipboard", title: "Clipboard", words: "copy paste select selection right click clipboard mouse" },
  { page: "terminal", section: "shell", title: "Default shell", words: "shell powershell pwsh cmd command prompt git bash wsl default" },
  { page: "terminal", section: "input", title: "Drawing and input", words: "ligatures typeface gpu webgl drawing render renderer terminal drawing hardware acceleration graphics middle click paste osc 52 osc52 clipboard programs hide pointer mouse cursor typing focus follows full-screen scroll speed option alt meta yen backslash japanese keyboard" },
  { page: "terminal", section: "powershell", title: "PowerShell version", words: "powershell pwsh 7 5 windows version" },
  { page: "terminal", section: "closing", title: "Ask Before Closing Running Terminals", words: "close closing quit ask confirm confirmation running busy agent program" },
  { page: "terminal", section: "links", title: "Links in terminals", words: "links web browser open ctrl click shift system menu" },
  { page: "terminal", section: "keys", title: "Keys in terminals", words: "keys keyboard chord terminal first shortcuts" },
  { page: "terminal", section: "terminal-import", title: "Import terminal settings", words: "import ghostty warp terminal settings colours colors scheme" },
  { page: "terminal", section: "ghostty-import", title: "Ghostty", words: "ghostty import config", parent: "terminal-import" },
  { page: "terminal", section: "warp-import", title: "Warp", words: "warp import theme", parent: "terminal-import" },
  { page: "git", section: "branches", title: "Branch names", words: "branch prefix name worktree auto automatic rename after the work new workspace ai folder" },
  { page: "git", section: "base", title: "Base branch", words: "base main master default branch" },
  { page: "git", section: "commit-writer", title: "Commit messages", words: "commit message write generate ai summary" },
  { page: "git", section: "ai-recipes", title: "Let AI write Git text", words: "ai write git text branch names pull request titles descriptions source control actions recipe generate fix" },
  { page: "git", section: "review-bots", title: "Review bots", words: "review bot bots comments author dependabot renovate marked pull request" },
  { page: "git", section: "gh-budget", title: "GitHub API budget", words: "github api rate limit requests pull pr" },
  { page: "git", section: "deleting", title: "Deleting workspaces", words: "delete remove worktree branch cleanup" },
  { page: "safety", section: "protected", title: "Protected actions", words: "protected ask asks prompt claude permission dangerous force push main delete rm drop database table stripe terraform infrastructure deploy production discard uncommitted reset rule rules master switch hooks" },
  { page: "safety", section: "custom-rules", title: "Your rules", words: "your rules custom rule pattern regex starts contains project scope reset" },
  { page: "safety", section: "attempts", title: "Recent attempts", words: "recent attempts blocked denied allowed commands paused clear" },
  { page: "notifications", section: "master", title: "Notifications", words: "notifications master switch on off all" },
  { page: "notifications", section: "beneath-master", title: "Notification choices", words: "" },
  { page: "notifications", section: "kinds", parent: "beneath-master", title: "What notifies you", words: "notify notification alert toast desktop" },
  { page: "notifications", section: "sound", parent: "beneath-master", title: "Sound", words: "sound audio chime volume mute beep" },
  { page: "notifications", section: "usage-alerts", parent: "beneath-master", title: "Usage alerts", words: "usage limit quota alert warning" },
  { page: "notifications", section: "alerts", title: "Finished and stopped", words: "finish finished done stopped quiet agent turn" },
  { page: "shortcuts", section: "shortcuts-file", title: "Shortcuts file", words: "keybindings json file reload open folder keys" },
  { page: "shortcuts", section: "layout-notes", title: "Keyboard layouts", words: "layout altgr german polish zoom interface rebind keyboard double tap modifier shift physical key" },
  { page: "shortcuts", section: "terminal-first", title: "Shortcuts in terminals", words: "terminal first kolux first keys chord policy" },
  { page: "shortcuts", section: "key-bindings", title: "Commands and keys", words: "keybindings keyboard hotkeys keys chords commands bindings" },
  { page: "usage", section: "activity", title: "Activity", words: "activity history sessions usage" },
  { page: "usage", section: "tokens", title: "Token analytics", words: "tokens cost spend money usage analytics" },
];

/** Longer search text is refused untouched (SET-007): no trimming or matching happens first. */
export const MAX_SEARCH = 100;
/** More matching repositories than this are listed only, so typing stays quick. */
export const MAX_REPOS_DRAWN = 3;

export type Hits = { pages: Array<{ page: PageId; sections: string[] | "all" }>; folds: Set<string>; refused: boolean };

const terms = (raw: string) => raw.toLowerCase().split(/\s+/).filter(Boolean);
const has = (text: string, ts: string[]) => {
  const t = text.toLowerCase();
  return ts.every((w) => t.includes(w));
};

/** ACCT-030: a match keeps its family on screen: the sections it is drawn inside (so they are not hidden)
 *  and, when the match is a wrapper, everything drawn inside it. Order stays that of the index. */
function withFamily(own: Entry[], found: Entry[]): Entry[] {
  const keep = new Set(found.map((e) => e.section));
  const parentOf = (s: string) => own.find((e) => e.section === s)?.parent;
  for (const e of found) for (let p = e.parent; p && !keep.has(p); p = parentOf(p)) keep.add(p);
  const inside = (e: Entry): boolean => { for (let p = e.parent; p; p = parentOf(p)) if (found.some((f) => f.section === p)) return true; return false; };
  return own.filter((e) => keep.has(e.section) || inside(e));
}

/** The pages and sections that hold every term. A page whose title matches comes first, then the
 *  others in page order; within a page the sections keep their order. Null when nothing is searched. */
export function searchSettings(raw: string): Hits | null {
  if (raw.length > MAX_SEARCH) return { pages: [], folds: new Set(), refused: true };
  const ts = terms(raw);
  if (ts.length === 0) return null;
  const folds = new Set<string>();
  const titled: Hits["pages"] = [];
  const rest: Hits["pages"] = [];
  for (const page of Object.keys(PAGES) as PageId[]) {
    const own = INDEX.filter((e) => e.page === page);
    if (has(PAGES[page], ts)) {
      titled.push({ page, sections: "all" });
      own.forEach((e) => e.fold && folds.add(e.fold));
      continue;
    }
    const hit = withFamily(own, own.filter((e) => has(`${PAGES[page]} ${e.title} ${e.words}`, ts)));
    if (hit.length === 0) continue;
    hit.forEach((e) => e.fold && folds.add(e.fold));
    rest.push({ page, sections: hit.map((e) => e.section) });
  }
  return { pages: [...titled, ...rest], folds, refused: false };
}

/** Repositories whose name or folder holds every term. */
export const searchRepos = <P extends { name: string; path: string }>(raw: string, projects: P[]): P[] => {
  const ts = raw.length > MAX_SEARCH ? [] : terms(raw);
  return ts.length === 0 ? [] : projects.filter((p) => has(`${p.name} ${p.path}`, ts));
};

/** While a search runs: the Appearance folds that hold a match (null when no search runs). */
export const SearchFolds = createContext<Set<string> | null>(null);

/** A style rule that hides the sections of a drawn page that hold no match. */
export function hideRule(hits: Hits): string {
  return hits.pages
    .filter((p) => p.sections !== "all")
    .map((p) => `.settings-found[data-page="${p.page}"] [data-section]${(p.sections as string[]).map((s) => `:not([data-section="${s}"])`).join("")} { display: none !important; }`)
    .join("\n");
}

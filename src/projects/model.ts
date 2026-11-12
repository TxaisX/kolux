import { locale } from "../language";
import { dirKey } from "../workspaces";
// The shapes the Rust side hands over for projects and workspaces, plus the pure helpers the
// sidebar draws from. No Tauri calls here, so it can be tested on its own.

export type Project = { id: string; name: string; path: string; workspacesDir?: string | null; base?: string | null; displayName?: string | null };

/** SET-033: the name a project shows in the sidebar and pickers: its display name when it has one, else the folder's name. */
export function projectLabel(p: Pick<Project, "name" | "displayName">): string {
  return p.displayName?.trim() || p.name;
}
/** What a typed name becomes in a project: its branch and the folder it would get (PROJ-021, PROJ-025). */
export type Preview = { branch: string; folder: string };
/** A workspace just made: the worktree, the ref it started from, a note when the saved base was gone (PROJ-028), and what could not be brought along (GIT-067). */
export type Created = Worktree & { base: string; note: string | null; warnings: string[] };
/** The global workspaces settings (PROJ-025): folder in use, layout, folders used before, and whether KOLUX_WORKSPACES_DIR supplies the folder (SET-032). */
export type PlaceInfo = { dir: string; flat: boolean; used: string[]; fromEnv: boolean };

/** What a key does in the workspaces-folder field (SET-032): Enter saves, Escape puts the saved folder back, and nothing happens while an input method is still composing. */
export function placeFieldAction(key: string, composing: boolean): "save" | "revert" | null {
  if (composing) return null;
  return key === "Enter" ? "save" : key === "Escape" ? "revert" : null;
}
/** `parent` is the workspace it was made from (PROJ-047); gone or main means it sits at the top level. */
export type Worktree = { path: string; branch: string | null; head: string; isMain: boolean; name?: string | null; parent?: string | null; hidden?: boolean; kind?: "main" | "managed" | "external" | ""; source?: string | null; madeBy?: string | null; number?: number | null; comment?: string | null };

/** SET-032 / PROJ-042: one visibility source; `own` is the project's choice over the global one. */
export type VisSource = { key: string; label: string; global: boolean; own: boolean | null; root: string | null };

/** PROJ-042: a worktree's folder as the visibility lists show it, relative to the project's folder. */
export function relPath(from: string, to: string): string {
  const parts = (p: string) => p.split(/[\\/]+/).filter(Boolean);
  const a = parts(from);
  const b = parts(to);
  let i = 0;
  while (i < a.length && i < b.length && a[i].toLowerCase() === b[i].toLowerCase()) i++;
  if (i === 0) return to;
  return [...a.slice(i).map(() => ".."), ...b.slice(i)].join("/") || ".";
}

/** The last folder name of a path, whichever slash style it uses. */
export function folderName(path: string): string {
  const parts = path.replace(/[\\/]+$/, "").split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

/** What a workspace row says (PROJ-021): the name as typed, else the branch, else the short commit of a detached head. */
export function worktreeLabel(w: Worktree): string {
  if (w.name) return w.name;
  if (w.branch) return w.branch;
  // GIT-064: with neither a branch nor a commit known no detached label shows; the row (and every
  // sentence that names it) falls back to the folder name.
  return w.head ? `detached at ${w.head.slice(0, 7)}` : folderName(w.path);
}

/** Rows in display order: the main checkout first, then the others by branch name. */
export function orderWorktrees(list: Worktree[]): Worktree[] {
  return [...list].sort((a, b) => {
    if (a.isMain !== b.isMain) return a.isMain ? -1 : 1;
    return worktreeLabel(a).localeCompare(worktreeLabel(b), locale());
  });
}

/** A sidebar row: the workspace, how deep it is indented and whether it has children to fold. */
export type Row = { w: Worktree; depth: number; kids: boolean };

/** The settings key that turns nesting off (PROJ-047); on unless set to false. */
export const NESTING_KEY = "workspaceNesting";

/**
 * PROJ-047: the non-main workspaces as rows, each child under its parent to any depth, siblings
 * in `sort` order (`orderWorktrees` unless the caller sorted already). A child whose parent is not listed (removed, or the main checkout)
 * sits at the top level; a folded row hides everything under it; nesting off is one flat level.
 */
export function nestRows(others: Worktree[], nest: boolean, folded: ReadonlySet<string>, sort: (ws: Worktree[]) => Worktree[] = orderWorktrees): Row[] {
  const sorted = sort(others);
  if (!nest) return sorted.map((w) => ({ w, depth: 0, kids: false }));
  const listed = new Set(sorted.map((w) => w.path));
  const under = new Map<string, Worktree[]>();
  for (const w of sorted) {
    const p = w.parent && w.parent !== w.path && listed.has(w.parent) ? w.parent : "";
    under.set(p, [...(under.get(p) ?? []), w]);
  }
  const rows: Row[] = [];
  const seen = new Set<string>();
  const walk = (parent: string, depth: number, hidden: boolean) => {
    for (const w of under.get(parent) ?? []) {
      if (seen.has(w.path)) continue;
      seen.add(w.path);
      const kids = (under.get(w.path) ?? []).length > 0;
      if (!hidden) rows.push({ w, depth, kids });
      walk(w.path, depth + 1, hidden || folded.has(w.path));
    }
  };
  walk("", 0, false);
  // A loop of parents (a is b's, b is a's) never reaches the top; list those flat rather than lose them.
  for (const w of sorted) if (!seen.has(w.path)) rows.push({ w, depth: 0, kids: false });
  return rows;
}

/**
 * PROJ-048: the workspaces `w` may be moved under: never itself, the parent it has now, anything
 * nested under it (that would make a loop) or the main checkout.
 */
export function parentChoices(all: Worktree[], w: Worktree): Worktree[] {
  const under = new Set([norm(w.path)]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const x of all) if (x.parent && under.has(norm(x.parent)) && !under.has(norm(x.path))) grew = !!under.add(norm(x.path));
  }
  return all.filter((x) => !x.isMain && !under.has(norm(x.path)) && !(w.parent && norm(w.parent) === norm(x.path)));
}

const norm = dirKey;
/** PROJ-006 / PROJ-007: after adding a project, the worktree at the folder that became the project, else the main checkout. */
export function openedWorktree(list: Worktree[], path: string): Worktree | undefined {
  return list.find((w) => norm(w.path) === norm(path)) ?? list.find((w) => w.isMain);
}

/** PROJ-020: New workspace works before any project exists, by opening the add-project form first. */
export function createOpens(projectId: string): "name" | "add" {
  return projectId ? "name" : "add";
}

/** PROJ-033: how the Setup terminal starts (Rust's SetupLine). */
export type SetupLine = { program: string; args: string[]; script: string };
/** PROJ-033: where the Setup terminal opens: a tab beside the workspace's first pane, or a split. */
export type SetupWhere = "tab" | "right" | "down";

/** PROJ-033: the agent waits for setup only in new-tab mode with wait on, and only when both run. */
export function waitsForSetup(where: SetupWhere, wait: boolean, agent: boolean, setup: boolean): boolean {
  return where === "tab" && wait && agent && setup;
}

/** PROJ-030: an open pull request the composer can open as a workspace (gh's fields). */
export type PrHead = { number: number; title: string; url: string; headRefName: string; headRefOid: string; isCrossRepository?: boolean; headRepositoryOwner?: { login: string } | null };

/** PROJ-030: the pull requests matching the typed text by number (with or without #), title or
 * head branch, in gh's order; the label is "#12 Title" and the hint the head branch. */
export function prItems(list: PrHead[], query: string): { key: string; label: string; hint: string }[] {
  const q = query.trim().toLowerCase().replace(/^#/, "");
  return list
    .filter((p) => !q || String(p.number).startsWith(q) || p.title.toLowerCase().includes(q) || p.headRefName.toLowerCase().includes(q))
    .map((p) => ({ key: String(p.number), label: `#${p.number} ${p.title}`, hint: p.isCrossRepository && p.headRepositoryOwner ? `${p.headRepositoryOwner.login}:${p.headRefName}` : p.headRefName }));
}

/** PROJ-020: a create the window has handed to Git and not yet heard back from. */
export type PendingCreate = { ticket: number; projectId: string; name: string; more: boolean };

/** PROJ-020: the tickets a newer create overtakes: every one still running except itself and
 * those made with Create more, which asked for several workspaces at once. */
export function overtakenBy(running: PendingCreate[], next: PendingCreate): number[] {
  return running.filter((p) => p.ticket !== next.ticket && !p.more).map((p) => p.ticket);
}

/** The sentence under the name field: where the branch and folder will go, or why it is refused.
 * `pending`: Git has not answered for this name yet, so a missing preview is not a refusal. */
export function previewSentence(typed: string, preview: Preview | null, project: Project | null, pending = false): string {
  if (!project) return "Add a project first.";
  if (typed.trim() === "") return "Type a name; its branch and folder are shown here.";
  if (preview === null && pending) return "Working out the branch and folder…";
  if (preview === null) return "That name leaves nothing usable for a branch; use some letters or digits.";
  return `branch ${preview.branch} · folder ${preview.folder}`;
}

/** What the command line tells the window after `worktree create` or `worktree rm` (PROJ-077). */
export type CliWorkspace =
  | { kind: "created"; projectId: string; worktree: Created; agent: string | null; prompt: string; activate: boolean; setup?: "run" | "skip" | "inherit" }
  | { kind: "start"; path: string; branch: string | null; agent: string; prompt: string; extra: string[]; title: string | null; runId?: string; dispatch?: string }
  | { kind: "removed"; path: string }
  // CLI-015 / CLI-019: a repo setting or a worktree's name, link, comment or parent changed; only a redraw.
  | { kind: "repo"; projectId: string }
  | { kind: "changed"; projectId: string; path: string }
  // CLI-026, CLI-027: the terminal commands; ask is the request the window answers through its layout.
  | { kind: "terminal-create"; path: string; branch: string | null; command: string | null; title: string | null; focus: boolean; ask: string }
  | { kind: "terminal-split"; handle: string; dir: "right" | "down"; command: string | null; ask: string }
  | { kind: "terminal-rename"; handle: string; title: string | null }
  | { kind: "terminal-switch"; handle: string }
  | { kind: "terminal-close"; handles: string[] }
  // CLI-022: a file to open as an editing tab or as a diff, in the named worktree.
  | CliFile;

// T-250-c: `ack` is the request number the window answers through cli_file_result once the tab is open.
export type CliFile = { kind: "file-open"; path: string; worktree: string; branch: string | null; ack?: number } | { kind: "file-diff"; path: string; staged: boolean; worktree: string; branch: string | null; ack?: number };

// SESS-035: the composer's project search. The typed letters in order inside `text`: one run when
// they appear together, else the first letters that fit; null when they are not all there.
export function matchLetters(query: string, text: string): number[] | null {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  const at = t.indexOf(q);
  if (at >= 0) return [...q].map((_, i) => at + i);
  const hits: number[] = [];
  for (let i = 0; i < t.length && hits.length < q.length; i++) if (t[i] === q[hits.length]) hits.push(i);
  return hits.length === q.length ? hits : null;
}

const matchScore = (hits: number[], text: string) => {
  const run = hits.every((h, i) => i === 0 || h === hits[i - 1] + 1);
  return (run ? 1000 : 500) - hits[0] * 10 - (hits[hits.length - 1] - hits[0]) - text.length;
};

type Named = { id: string; name: string; path: string };
export type ProjectMatch<P extends Named> = { p: P; hits: number[] };

/** Recent projects first (in the order they were used), then match quality; no query keeps the list order. */
export function rankProjects<P extends Named>(projects: P[], query: string, recent: string[]) {
  const q = query.trim();
  const found: (ProjectMatch<P> & { score: number })[] = [];
  for (const p of projects) {
    const hits = q ? matchLetters(q, p.name) : [];
    if (hits) found.push({ p, hits, score: q ? matchScore(hits, p.name) : 0 });
  }
  const byScore = (a: { score: number }, b: { score: number }) => b.score - a.score;
  const isRecent = (m: { p: P }) => recent.includes(m.p.id);
  return {
    recent: found.filter(isRecent).sort((a, b) => (q ? byScore(a, b) : recent.indexOf(a.p.id) - recent.indexOf(b.p.id))),
    rest: found.filter((m) => !isRecent(m)).sort((a, b) => (q ? byScore(a, b) : 0)),
  };
}

/** `s` cut to `max` characters by taking out its middle. */
export function middle(s: string, max: number): string {
  if (s.length <= max) return s;
  const keep = max - 1;
  return `${s.slice(0, Math.ceil(keep / 2))}…${s.slice(s.length - Math.floor(keep / 2))}`;
}

/** For projects that share a name, the fewest trailing folders of their parent path that tell them apart. */
export function pathHints(projects: Named[]): Record<string, string> {
  const out: Record<string, string> = {};
  const groups = new Map<string, Named[]>();
  for (const p of projects) groups.set(p.name.toLowerCase(), [...(groups.get(p.name.toLowerCase()) ?? []), p]);
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const parts = group.map((p) => p.path.split(/[\\/]/).filter(Boolean).slice(0, -1));
    const most = Math.max(...parts.map((x) => x.length));
    for (let k = 1; k <= most; k++) {
      const tails = parts.map((x) => x.slice(-k).join("/"));
      if (new Set(tails).size === tails.length || k === most) {
        group.forEach((p, i) => (out[p.id] = p.path.includes("\\") ? tails[i].replace(/\//g, "\\") : tails[i]));
        break;
      }
    }
  }
  return out;
}

// SESS-036: a few common shortcodes; others stay as typed.
const SHORTCODES: Record<string, string> = {
  bug: "\u{1F41B}", rocket: "\u{1F680}", fire: "\u{1F525}", sparkles: "\u{2728}", tada: "\u{1F389}", zap: "\u{26A1}",
  wrench: "\u{1F527}", hammer: "\u{1F528}", memo: "\u{1F4DD}", lock: "\u{1F512}", art: "\u{1F3A8}", lipstick: "\u{1F484}",
  recycle: "\u{267B}\u{FE0F}", construction: "\u{1F6A7}", white_check_mark: "\u{2705}", x: "\u{274C}", warning: "\u{26A0}\u{FE0F}",
  rotating_light: "\u{1F6A8}", books: "\u{1F4DA}", package: "\u{1F4E6}", test_tube: "\u{1F9EA}", broom: "\u{1F9F9}",
  star: "\u{2B50}", heart: "\u{2764}\u{FE0F}", eyes: "\u{1F440}", bulb: "\u{1F4A1}", gear: "\u{2699}\u{FE0F}", boom: "\u{1F4A5}",
};
export const shortcodes = (s: string) => s.replace(/:([a-z0-9_+-]+):/g, (all, code: string) => SHORTCODES[code] ?? all);

/** ACCT-056: what the sidebar lists after a scan; one that failed (null) keeps the worktrees
 * already known instead of emptying the project. */
export const afterScan = (known: Worktree[] | undefined, scanned: Worktree[] | null): Worktree[] => scanned ?? known ?? [];

/** SET-031: what the back end makes of a branch prefix: the prefix new branches get, and whether Git refused it. */
export type PrefixCheck = { prefix: string; refused: boolean };

/** SET-031: the live sample of the next branch name under the prefix field, and why a prefix is not used. */
export function prefixSample(mode: string, custom: string, check: PrefixCheck | null): { sample: string; note: string | null } {
  const sample = `${check?.prefix ?? ""}<name>`;
  const typed = custom.trim();
  if (mode !== "custom") return { sample, note: null };
  if (check?.refused) return { sample, note: `Git does not accept "${typed}" in a branch name, so new branches get no prefix.` };
  if (/^\/+$/.test(typed)) return { sample, note: "A prefix of only slashes is no prefix, so new branches get the bare name." };
  return { sample, note: null };
}

/** PROJ-037: a GitHub issue or pull request named by its address. */
export type WorkItem = { host: string; owner: string; repo: string; kind: "pull" | "issue"; number: number };

/** The issue or pull request an address names; null for anything else, a plain name or a
 * repository's home page included. Any host, so an Enterprise address counts too. */
export function workItem(text: string): WorkItem | null {
  const m = /^https?:\/\/([^/\s]+)\/([\w.-]+)\/([\w.-]+)\/(pull|issues)\/(\d+)(?:[/?#]\S*)?$/i.exec(text.trim());
  if (!m || Number(m[5]) === 0) return null;
  return { host: m[1].toLowerCase().replace(/^www\./, ""), owner: m[2], repo: m[3], kind: m[4].toLowerCase() === "pull" ? "pull" : "issue", number: Number(m[5]) };
}

/** SESS-036: the issue or pull request (or, later, a tracker item) a new workspace is linked to;
 * `repo` is the GitHub repository it belongs to, null for a tracker link bound to none. */
export type Linked = { kind: string; number: number; title: string; url: string; repo: string | null };

/** A GitHub item as the back end found it, bound to the repository its address names. */
export const bound = (l: Omit<Linked, "repo">): Linked => {
  const w = workItem(l.url);
  return { ...l, repo: w ? `${w.host}/${w.owner}/${w.repo}` : l.url };
};

export const itemLabel = (l: Linked) => `${l.kind === "pull" ? "pull request" : l.kind} #${l.number} ${l.title}`;

/** SESS-038: switching project drops a GitHub item of the old repository, keeps a link bound to none. */
export const keepOnSwitch = (l: Linked | null): Linked | null => (l && l.repo === null ? l : null);

/** SESS-038: what a create the user cancelled mid-submit says: `err` is the back end's answer, null
 * when Git had already finished (the workspace then stays). */
export function stoppedNote(name: string, err: string | null): { kind: "ok" | "warn"; text: string } {
  if (err === null) return { kind: "warn", text: `${name} was already made when the cancel arrived, so it stays; delete it if you do not want it.` };
  const lead = "cancelled: a newer workspace creation took its place";
  if (!err.startsWith(lead)) return { kind: "warn", text: `${name}: ${err}` };
  const rest = err.slice(lead.length);
  return rest ? { kind: "warn", text: `Stopped creating ${name}${rest}` } : { kind: "ok", text: `Stopped creating ${name}; nothing was left behind.` };
}

/** PROJ-031: a failed create arrives as Kolux's words, then "\nGit said: " and Git's full output;
 * the page shows the first part and keeps the second behind a details control. */
export function splitGitSaid(text: string): { summary: string; git: string | null } {
  const at = text.indexOf("\nGit said: ");
  return at < 0 ? { summary: text, git: null } : { summary: text.slice(0, at), git: text.slice(at + "\nGit said: ".length) };
}

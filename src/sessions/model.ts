// VIEW-081 / VIEW-080 (T-168, T-169): the session list's pure side: what a search means, which
// sessions pass the filters, how they group, and how a folder is labelled. The Rust side
// (session_list.rs) finds the sessions; the panel only draws what these functions return.

import { gridOf } from "../workspaces";

export type Session = { agent: string; id: string; title: string; modifiedMs: number; bytes: number; turns: number; dir: string | null };
export type GroupBy = "none" | "folder" | "agent" | "project";
export type SortBy = "recent" | "oldest" | "title";
/** A pasted search longer than this returns nothing at once instead of scanning every session. */
export const MAX_QUERY = 500;

export type Query = { words: string[]; phrases: string[]; repo: string | null; path: string | null; tooLong: boolean };

/** Text compared the same whatever way its accented or non-Latin characters were encoded. */
export const normText = (s: string): string => s.normalize("NFC").toLowerCase();
/** A folder compared by its parts: one kind of slash, no trailing slash, normalised text. */
export const normPath = (s: string): string => normText(s).replace(/^\\\\\?\\/, "").replace(/\\/g, "/").replace(/\/+$/, "");

/** VIEW-081: plain words, "quoted phrases", repo:name and path:fragment (a value may be quoted too). */
export function parseQuery(text: string): Query {
  const q: Query = { words: [], phrases: [], repo: null, path: null, tooLong: text.length > MAX_QUERY };
  if (q.tooLong) return q;
  const re = /(?:(repo|path):)?(?:"([^"]*)"|(\S+))/gi;
  for (const m of text.matchAll(re)) {
    const key = m[1]?.toLowerCase();
    const value = normText(m[2] ?? m[3] ?? "").trim();
    if (value === "") continue;
    if (key === "repo") q.repo = value;
    else if (key === "path") q.path = normPath(value);
    else if (m[2] !== undefined) q.phrases.push(value);
    else q.words.push(value);
  }
  return q;
}

export type Project = { path: string };

/** The project root a folder sits under (the deepest one); a blank root never matches; none gives the folder itself.
 *  F26: a worktree outside its project's folder (the default workspaces folder) counts under the project whose grid
 *  shows it (`gridOf`). */
export function projectOf(dir: string | null, projects: Project[]): string | null {
  if (dir === null) return null;
  const d = normPath(gridOf(dir) ?? dir);
  const roots = projects.map((p) => p.path.trim()).filter((p) => p !== "").map(normPath);
  const home = roots.filter((r) => d === r || d.startsWith(`${r}/`)).sort((a, b) => b.length - a.length)[0];
  return home ?? d;
}

/** VIEW-081: a compact label from the last two parts of a path. */
export function shortLabel(dir: string | null): string {
  if (dir === null) return "Unknown folder";
  const parts = dir.replace(/^\\\\\?\\/, "").split(/[\\/]+/).filter((p) => p !== "");
  return parts.slice(-2).join("/") || dir;
}

const repoName = (dir: string | null, projects: Project[]): string => {
  const root = projectOf(dir, projects);
  return root === null ? "" : (root.split("/").pop() ?? "");
};

/** Whether a session matches the search. An oversized search matches nothing. */
export function matches(s: Session, q: Query, projects: Project[]): boolean {
  if (q.tooLong) return false;
  const dir = s.dir === null ? "" : normPath(s.dir);
  if (q.repo !== null && !repoName(s.dir, projects).includes(q.repo)) return false;
  if (q.path !== null && !dir.includes(q.path)) return false;
  const hay = normText(`${s.title} ${s.agent} ${dir}`);
  return q.words.every((w) => hay.includes(w)) && q.phrases.every((p) => hay.includes(p));
}

/** A session with nothing to show: no turns and no title. One with a title keeps recoverable content. */
export const isEmpty = (s: Session): boolean => s.turns === 0 && s.title.trim() === "";

export type Filters = { query: string; hiddenAgents: string[]; hideEmpty: boolean };

export function filterSessions(list: Session[], f: Filters, projects: Project[]): Session[] {
  const q = parseQuery(f.query);
  if (q.tooLong) return [];
  return list.filter((s) => !f.hiddenAgents.includes(s.agent) && !(f.hideEmpty && isEmpty(s)) && matches(s, q, projects));
}

export function sortSessions(list: Session[], by: SortBy): Session[] {
  const out = [...list];
  if (by === "oldest") out.sort((a, b) => a.modifiedMs - b.modifiedMs);
  else if (by === "title") out.sort((a, b) => a.title.localeCompare(b.title) || b.modifiedMs - a.modifiedMs);
  else out.sort((a, b) => b.modifiedMs - a.modifiedMs);
  return out;
}

export type Group = { key: string; label: string; sessions: Session[] };

/** VIEW-081: groups by folder, agent or project, groups ordered by their newest session. */
export function groupSessions(list: Session[], by: GroupBy, projects: Project[]): Group[] {
  if (by === "none") return [{ key: "", label: "", sessions: list }];
  const groups = new Map<string, Group>();
  for (const s of list) {
    const key = by === "agent" ? s.agent : by === "folder" ? (s.dir === null ? "" : normPath(s.dir)) : (projectOf(s.dir, projects) ?? "");
    const root = by === "project" ? projects.find((p) => normPath(p.path) === key) : undefined;
    const label = by === "agent" ? s.agent : by === "project" && root ? shortLabel(root.path) : shortLabel(s.dir);
    const g = groups.get(key) ?? { key, label, sessions: [] };
    g.sessions.push(s);
    groups.set(key, g);
  }
  return [...groups.values()].sort((a, b) => Math.max(...b.sessions.map((s) => s.modifiedMs)) - Math.max(...a.sessions.map((s) => s.modifiedMs)));
}

/** "3 min ago" style text for a time in ms. */
export function ago(ms: number, now: number): string {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

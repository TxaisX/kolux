// VIEW-010 / GIT-043: the Tasks page, GitHub-only: issues and pull requests found by GitHub search.
import type { Project } from "../projects/model";
import { sameDir } from "../workspaces";
import { wantedState } from "./edits";

export type TaskLabel = { name: string; color: string };
export type Task = { kind: string; number: number; title: string; url: string; repo: string; state: string; draft: boolean; labels: TaskLabel[]; assignees: string[]; updated: string; checks: string | null;
  /** The host that answered with this row (stamped by the page; the search itself does not know it). */
  host?: string };
/** `failed`: repositories GitHub refused to search (GIT-045); the other repositories' items are in `items`. */
export type TaskPage = { total: number; deepest: number; items: Task[]; failed?: { repo: string; error: string }[] };

/** The checkout whose GitHub repository the page lists: the workspace on screen, else the first project. */
export function tasksRepo(projects: Project[], activeDir: string | null): { dir: string; name: string } | null {
  if (activeDir) return { dir: activeDir, name: projects.find((p) => sameDir(p.path, activeDir))?.name ?? activeDir.split(/[\/]/).filter(Boolean).pop() ?? activeDir };
  return projects[0] ? { dir: projects[0].path, name: projects[0].name } : null;
}

export function taskKind(t: Pick<Task, "kind" | "draft" | "number">): string {
  return t.kind === "issue" ? `Issue #${t.number}` : `${t.draft ? "Draft pull request" : "Pull request"} #${t.number}`;
}

type Kind = "issue" | "pr";
/** GIT-043: the presets; the first (everything open) is VIEW-010's default. */
export const PRESETS: { id: string; label: string; q: string; kinds: Kind[] }[] = [
  { id: "all", label: "All open", q: "is:open", kinds: ["issue", "pr"] },
  { id: "mine", label: "Created by me", q: "is:open author:@me", kinds: ["issue", "pr"] },
  { id: "assigned", label: "Assigned to me", q: "is:open assignee:@me", kinds: ["issue", "pr"] },
  { id: "review", label: "Needs my review", q: "is:open review-requested:@me", kinds: ["pr"] },
  { id: "mentioned", label: "Mentions me", q: "is:open mentions:@me", kinds: ["issue", "pr"] },
  { id: "closed", label: "Recently closed", q: "is:closed", kinds: ["issue", "pr"] },
];

/** GIT-043: the GitHub searches for a preset, a typed query and the chosen repositories (owner/name):
 * one per kind the preset shows, unless the query names is:issue or is:pr itself. GIT-055: issues may
 * come from other repositories than pull requests (a fork listing its parent's issues). GIT-054: a
 * typed state (is:open, is:closed, is:merged) replaces the preset's own. */
export function taskQueries(preset: string, typed: string, repos: string[], issueRepos: string[] = repos): string[] {
  if (repos.length === 0) return [];
  const p = PRESETS.find((x) => x.id === preset) ?? PRESETS[0];
  const words = queryWords(typed);
  const stated = words.some((w) => STATE_WORD.test(w));
  const base = p.q.split(" ").filter((w) => !(stated && STATE_WORD.test(w)));
  const kindOf = (w: string) => /^(is|type):(issue|pr|pull-request)$/i.exec(w)?.[2].toLowerCase();
  const named = words.map(kindOf).find(Boolean);
  const q = (k: string) => [...base, ...words, ...(k === "issue" ? issueRepos : repos).map((r) => `repo:${r}`)].join(" ");
  if (named) return [q(named === "issue" ? "issue" : "pr")];
  return p.kinds.map((k) => `is:${k} ${q(k)}`);
}

/** GIT-048: the state the list is filtered to (the typed words win over the preset's), or null. */
export function listState(preset: string, typed: string): string | null {
  const p = PRESETS.find((x) => x.id === preset) ?? PRESETS[0];
  return wantedState(queryWords(typed)) ?? wantedState(p.q.split(" "));
}

const STATE_WORD = /^(is|state):(open|closed|merged)$/i;

/** A search split into its words, a quoted part (label:"needs review") kept whole. */
export function queryWords(q: string): string[] {
  return q.match(/(?:[^\s"]+|"[^"]*")+/g) ?? [];
}

/** GIT-054: the PR filter pickers, each one part of the GitHub query. */
export type FilterKey = "state" | "author" | "assignee" | "label" | "review-requested" | "reviewed-by";
export const FILTERS: { key: FilterKey; label: string; prOnly: boolean }[] = [
  { key: "state", label: "State", prOnly: false },
  { key: "author", label: "Author", prOnly: false },
  { key: "assignee", label: "Assignee", prOnly: false },
  { key: "label", label: "Label", prOnly: false },
  { key: "review-requested", label: "Review requested", prOnly: true },
  { key: "reviewed-by", label: "Reviewed by", prOnly: true },
];
const ownWord = (key: FilterKey, w: string) => (key === "state" ? STATE_WORD.test(w) : w.toLowerCase().startsWith(`${key}:`));
const unquote = (v: string) => v.replace(/^"(.*)"$/, "$1");

/** GIT-054: the value a filter has in the query now, or "". */
export function filterValue(query: string, key: FilterKey): string {
  const w = queryWords(query).find((x) => ownWord(key, x));
  return w ? unquote(w.slice(w.indexOf(":") + 1)) : "";
}

/** GIT-054: the query with one filter set (or cleared, with an empty value); every other part stays.
 * A pull-request-only filter (review requested, reviewed by, merged) also narrows the list to
 * pull requests. */
export function setFilter(query: string, key: FilterKey, value: string): string {
  const words = queryWords(query).filter((w) => !ownWord(key, w));
  const v = value.trim();
  if (v) {
    words.push(key === "state" ? `is:${v}` : `${key}:${/\s/.test(v) ? `"${v}"` : v}`);
    const prOnly = FILTERS.find((f) => f.key === key)?.prOnly || (key === "state" && v === "merged");
    if (prOnly && !words.some((w) => /^(is|type):(pr|pull-request)$/i.test(w))) {
      const i = words.findIndex((w) => /^(is|type):issue$/i.test(w));
      if (i >= 0) words.splice(i, 1);
      words.unshift("is:pr");
    }
  }
  return words.join(" ");
}

/** GIT-044: the preset Tasks opens on: the saved default when it names a preset, else All open. */
export function defaultPreset(settings: Record<string, unknown> | null): string {
  const v = settings?.tasksDefaultPreset;
  return typeof v === "string" && PRESETS.some((p) => p.id === v) ? v : PRESETS[0].id;
}

/** GIT-055: where a repository's issues come from. A fork may choose its parent ("upstream"); the
 * choice is kept per repository (host/owner/name). A chosen parent that is gone falls back to the
 * repository itself, with a warning; so does a parent read that failed (FIX-1), never shown as still checking. */
export type IssueSource = { repo: string; warning: string | null; split: boolean };
export function issueSource(settings: Record<string, unknown> | null, key: string, own: string, parent: string | null | undefined, failed = false): IssueSource {
  const saved = settings?.tasksIssueSource;
  const choice = saved && typeof saved === "object" ? (saved as Record<string, unknown>)[key] : undefined;
  if (choice === "upstream" && failed) return { repo: own, warning: `Could not check this fork's upstream; issues come from ${own}.`, split: false };
  if (choice !== "upstream" || parent === undefined) return { repo: own, warning: null, split: false };
  if (!parent) return { repo: own, warning: `The upstream repository you chose for ${own}'s issues is no longer set up (it is gone, or ${own} is no longer a fork of it), so issues come from ${own}.`, split: false };
  return { repo: parent, warning: null, split: true };
}

export const PER_PAGE = 25;
const WINDOW = 1000;
/** Pages there are to show; GitHub search hands out its first 1000 results only. */
export const pageCount = (deepest: number) => Math.max(1, Math.ceil(Math.min(deepest, WINDOW) / PER_PAGE));
export const beyondWindow = (deepest: number) => deepest > WINDOW;

/** Whether the pager shows: on any page with rows, and on an empty page past the first, so the user can go back. */
export const showPager = (rows: number, page: number) => rows > 0 || page > 1;

/** Numbered page buttons: the first, the last and two either side of the current; null is a gap. */
export function pageButtons(page: number, count: number): (number | null)[] {
  const out: (number | null)[] = [];
  for (let n = 1; n <= count; n++) {
    if (n === 1 || n === count || Math.abs(n - page) <= 2) out.push(n);
    else if (out[out.length - 1] !== null) out.push(null);
  }
  return out;
}

export type TaskEvent = { kind: string; actor: string; at: string; detail: string };
export type TaskDetail = { title: string; body: string; state: string; labels: TaskLabel[]; assignees: string[]; updated: string; events: TaskEvent[] };

/** GIT-050: one timeline event in words, such as "@txais added the label bug". */
export function eventLine(e: TaskEvent): string {
  const d = e.detail;
  const verbs: Record<string, string> = {
    labeled: `added the label ${d}`,
    unlabeled: `removed the label ${d}`,
    assigned: d === e.actor ? "self-assigned this" : `assigned @${d}`,
    unassigned: d === e.actor ? "unassigned themselves" : `unassigned @${d}`,
    review_requested: `asked @${d} for a review`,
    review_request_removed: `took back the review request for @${d}`,
    closed: "closed this",
    reopened: "reopened this",
    merged: "merged this",
    mentioned: "was mentioned",
    renamed: `renamed this: ${d}`,
    commented: `commented: ${d}`,
    reviewed: d ? `reviewed: ${d}` : "reviewed",
    committed: `committed ${d}`,
    "cross-referenced": `mentioned this in ${d}`,
    referenced: `referenced this in commit ${d}`,
  };
  const verb = verbs[e.kind] ?? e.kind.replace(/[_-]/g, " ");
  return e.actor ? `@${e.actor} ${verb}` : verb;
}

/** GIT-047: the issue number typed for "duplicate of" (`12` or `#12`); null for anything else. */
export function issueNumber(text: string): number | null {
  const m = /^#?(\d{1,9})$/.exec(text.trim());
  const n = m ? Number(m[1]) : 0;
  return n > 0 ? n : null;
}

/** GIT-047: the search that suggests what an issue may duplicate: other issues in the same
 * repository sharing words of its title (quotes, brackets and search words like is: left out). */
export function duplicateQuery(repo: string, title: string): string | null {
  const words = title
    .replace(/["\\()[\]]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !w.includes(":"))
    .slice(0, 6);
  return words.length ? `repo:${repo} is:issue ${words.join(" ")}` : null;
}

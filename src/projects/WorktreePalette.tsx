// PROJ-057 / VIEW-037: the worktree palette. One list with sections for open tabs, worktrees,
// projects, settings pages, quick actions and pull requests; every typed word has to land on a
// row, matches are highlighted, and Enter goes there or makes a workspace from the typed name.
// VIEW-038 ranks the rows, VIEW-041 narrows them with filter chips, VIEW-042 creates at once and
// keeps worktree-only actions from running without a worktree.
import { Fragment, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { workItem, worktreeLabel, type Project, type Worktree } from "./model";
import { MAX_QUERY, fold, queryWords, scoreText } from "./nav";
import { sameDir } from "../workspaces";
import { githubItem, workspaceFor } from "../scm/paste";
import type { AgentState } from "./rows";
import type { Badge } from "../terminal/tabs";
import { VOCAB } from "../terminal/status";
import { StatusGlyph } from "../chrome/icons";
import { capRows, moreLabel, moreTitle, restoreFocus } from "../shell/paletteCaps";

/** A row the window supplies: its section, what it shows, and what Enter does. `parent` is the
 * project a row belongs to (matched after the row's own text), `dir` the folder it stands for
 * (for recency and its repository), `needs` what must be open for it to run, `keywords` other words
 * that find it (matched last, never shown; T-728). */
export type PaletteItem = { section: string; label: string; hint?: string; keywords?: string; parent?: string; dir?: string; repo?: string; number?: number; needs?: "worktree"; run: () => void; mark?: Badge; since?: number };

/** VIEW-041: one filter chip. Values of one field mean any of them; different fields must all match. */
export type Chip = { field: "repo" | "section"; value: string };
/** VIEW-040: what a workspace row's agents are doing and since when. */
export type RowAt = { mark: Badge; since: number } | null;

/** VIEW-040: a workspace row's mark from its strongest state: a request for the user beats unread
 * output, which beats a finished turn; work in progress keeps its spinner, as on the tab, and
 * work that only watches background tasks after its turn (STAT-024) shows the radio mark. */
export function dirMark(state: AgentState | null, unread: boolean, monitoring = false): Badge {
  if (state === "permission" || state === "waiting") return "permission";
  if (state === "working") return monitoring ? "background" : "working";
  if (unread) return "unread";
  // DT-C52: a stop (a limit, a sign-in, an interrupt) is not a question: Stopped, as on the tab (tabs.ts).
  if (state === "blocked" || state === "interrupted") return "stopped";
  return state === "done" ? "done" : null;
}

/** VIEW-040 / STAT-024: a folder counts as monitoring only when every pane in it that the hook
 * calls working is just watching background work; one pane really working keeps the spinner. */
export function dirMonitoring(panes: { state?: AgentState; monitoring?: boolean }[]): boolean {
  const working = panes.filter((p) => p.state === "working");
  return working.length > 0 && working.every((p) => p.monitoring === true);
}

/** VIEW-040: minutes until a whole hour has passed, hours until two days, then days. */
export function paletteAge(since: number, now: number): string {
  const m = Math.floor((now - since) / 60_000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 48 ? `${h}h` : `${Math.floor(h / 24)}d`;
}

/** VIEW-040: the mark and age at the start of a palette row. */
export function RowMark({ mark, since, now }: { mark: Badge; since: number; now: number }) {
  if (!mark) return null;
  return (
    <span className="palette-mark">
      {mark === "unread" ? (
        <span className={`badge unread dot`} role="img" aria-label="unread" data-tip="Finished or rang the bell while you were away." />
      ) : (
        <span className={`badge ${mark}`} role="img" aria-label={mark === "permission" ? "needs permission" : mark === "background" ? "monitoring" : mark} data-tip={VOCAB[mark].explain}>
          <StatusGlyph glyph={VOCAB[mark].glyph} size={11} />
        </span>
      )}
      {since > 0 ? <span className="palette-age">{paletteAge(since, now)}</span> : null}
    </span>
  );
}

export const SECTIONS = ["Open tabs", "Worktrees", "Projects", "Settings", "Quick actions", "Pull requests"] as const;

type Props = {
  projects: Project[];
  /** Rows other than worktrees and projects. */
  items: PaletteItem[];
  /** Each workspace folder's pull request state, from the sidebar's row states. */
  prOf: (dir: string) => string | null;
  /** VIEW-040: each workspace folder's agent mark and when it last changed. */
  atOf?: (dir: string) => RowAt;
  /** Folders by when they were last shown, the latest first (VIEW-038 ties). */
  recent: string[];
  /** VIEW-041: the repositories (project ids) the chips start with. */
  scope: string[];
  /** VIEW-042: a worktree is open, so worktree-only actions can run. */
  hasWorktree: boolean;
  onWorktree: (w: Worktree) => void;
  /** Enter on the last row: make a workspace named after the query (PROJ-037: or from the issue
   * or pull request the query's address names), in `repo` when one repository chip is set. */
  onCreate: (name: string, repo: string | null) => void;
  onClose: () => void;
  /** GIT-058: each workspace folder's linked pull request address (the scmLinkedPrs setting). */
  linked?: Record<string, string>;
  /** GIT-058: the GitHub hosts a pasted link may name (github.com when not given). */
  hosts?: readonly string[];
  /** GIT-058: open a pasted issue or pull request that has no workspace; without it, pasted links offer nothing. */
  onItem?: (url: string) => void;
};

type Row = PaletteItem & { spans: [number, number][]; off: boolean };

/** The worktree rows: with an empty query hidden ones stay out (main checkouts always show); a
 * typed query searches every worktree. */
export function worktreeItems(projects: Project[], lists: Record<string, Worktree[]>, typed: boolean, prOf: (dir: string) => string | null, go: (w: Worktree) => void, atOf: (dir: string) => RowAt = () => null): PaletteItem[] {
  const out: PaletteItem[] = [];
  for (const p of projects) {
    const ws = (lists[p.id] ?? []).filter((w) => typed || w.isMain || !w.hidden);
    const num = (w: Worktree) => (w.number ? ` · #${w.number}` : "");
    const number = (w: Worktree) => w.number ?? undefined;
    // EDIT-047: the comment it was made with is shown, and found, after the branch
    for (const w of ws) out.push({ section: "Worktrees", label: worktreeLabel(w), hint: (w.branch ?? "detached") + num(w) + (w.comment ? ` · ${w.comment}` : ""), parent: p.name, dir: w.path, repo: p.id, number: number(w), run: () => go(w), ...atOf(w.path) });
    const main = ws.find((w) => w.isMain) ?? ws[0];
    if (main) out.push({ section: "Projects", label: p.name, hint: p.path, dir: main.path, repo: p.id, run: () => go(main) });
    for (const w of ws) {
      const pr = prOf(w.path);
      if (pr && pr !== "suppressed") out.push({ section: "Pull requests", label: `${w.branch ?? worktreeLabel(w)}`, hint: `${pr} pull request${num(w)}`, parent: p.name, dir: w.path, repo: p.id, number: number(w), run: () => go(w) });
    }
  }
  return out;
}

const slashed = (p: string) => fold(p.replace(/\\/g, "/").replace(/\/+$/, ""));

/** VIEW-041: rows with a folder but no repository (open tabs) get the one whose worktree holds it. */
export function withRepos(items: PaletteItem[], lists: Record<string, Worktree[]>): PaletteItem[] {
  return items.map((it) => {
    if (it.repo || !it.dir) return it;
    const dir = slashed(it.dir);
    const repo = Object.entries(lists).find(([, ws]) => ws.some((w) => dir === slashed(w.path) || dir.startsWith(slashed(w.path) + "/")))?.[0];
    return repo ? { ...it, repo } : it;
  });
}

/** VIEW-041: the rows every chip field allows. */
export function chipFilter(items: PaletteItem[], chips: Chip[]): PaletteItem[] {
  const want = (f: Chip["field"]) => chips.filter((c) => c.field === f).map((c) => c.value);
  const repos = want("repo");
  const sections = want("section");
  return items.filter((it) => (repos.length === 0 || (it.repo !== undefined && repos.includes(it.repo))) && (sections.length === 0 || sections.includes(it.section)));
}

/** VIEW-041: the repository chip's options, most workspaces first; hidden ones do not count. */
export function repoOptions(projects: Project[], lists: Record<string, Worktree[]>): { id: string; name: string; count: number }[] {
  return projects.map((p) => ({ id: p.id, name: p.name, count: (lists[p.id] ?? []).filter((w) => !w.hidden).length })).sort((a, b) => b.count - a.count);
}

/** GIT-058: what a pasted GitHub issue or pull request link offers. The workspace whose linked pull
 * request is that item comes first (it opens); else the item itself opens. Other text offers nothing. */
export function pastedItems(text: string, linked: Record<string, string>, hosts: readonly string[], find: (dir: string) => Worktree | undefined, openItem: (url: string) => void, go: (w: Worktree) => void): PaletteItem[] {
  const url = githubItem(text, hosts);
  if (!url) return [];
  const [owner, repo, kind, num] = url.slice("https://".length).split("/").slice(1);
  const name = `${owner}/${repo}#${num}`;
  const dir = workspaceFor(url, linked, hosts);
  const w = dir ? find(dir) : undefined;
  if (w) return [{ section: "Worktrees", label: `Open the workspace for ${name}`, hint: w.branch ?? worktreeLabel(w), dir: w.path, run: () => go(w) }];
  return [{ section: "Pull requests", label: `Open ${kind === "pull" ? "pull request" : "issue"} ${name}`, hint: url, run: () => openItem(url) }];
}

/** GIT-058: Alt and a digit pick the numbered entry shown in the switcher (1 is the first row);
 * null for any other key. Plain digits stay in the search box and Ctrl or Cmd keep their own chords. */
export function chordRow(e: { altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey?: boolean; code: string }): number | null {
  const m = /^Digit([1-9])$/.exec(e.code);
  return m && e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey ? Number(m[1]) - 1 : null;
}

/** ponytail: scoring stops after this long on a huge list and shows what it scored; an index
 * built once per open if lists of tens of thousands ever appear. */
const BUDGET_MS = 40;

/** VIEW-038: the rows that match every word. With no query: section order, the one used last first
 * (EDIT-047), then as listed. With one: the worktree linked to a typed number first (EDIT-047), then
 * own-field matches before project-only ones, then exact intent, whole word, start of a word,
 * inside or forgiven; on a tie open tabs, then the one used last. Sections follow their best row. */
export function paletteRows(items: PaletteItem[], query: string, recent: string[] = [], hasWorktree = true): Row[] {
  const words = queryWords(query);
  const start = performance.now();
  const scored: { row: Row; key: number[] }[] = [];
  for (let i = 0; i < items.length; i++) {
    if (i % 64 === 63 && performance.now() - start > BUDGET_MS) break;
    const it = items[i];
    const own = it.hint ? `${it.label} ${it.hint}` : it.label;
    const hay = it.parent ? `${own} · ${it.parent}` : own;
    const hit = scoreText(it.keywords ? `${hay} · ${it.keywords}` : hay, own.length, words);
    if (!hit) continue;
    const intent = words.length === 1 && it.number !== undefined && words[0] === String(it.number) ? 5 : words.length > 0 && fold(it.label).trim() === words.join(" ") ? 4 : hit.tier;
    const used = it.dir ? recent.findIndex((d) => sameDir(d, it.dir!)) : -1;
    const row: Row = { ...it, spans: hit.spans, off: it.needs === "worktree" && !hasWorktree };
    // Sections not in SECTIONS (Commands, Accounts, Browser...) list after the named ones, so an empty query's Enter never runs a command.
    const named = SECTIONS.indexOf(it.section as (typeof SECTIONS)[number]);
    const section = named < 0 ? SECTIONS.length : named;
    scored.push({ row, key: words.length === 0 ? [-section, used < 0 ? -1e9 : -used, -i] : [hit.own ? 1 : 0, intent, it.section === "Open tabs" ? 1 : 0, used < 0 ? -1e9 : -used, -i] });
  }
  scored.sort((a, b) => {
    for (let k = 0; k < a.key.length; k++) if (a.key[k] !== b.key[k]) return b.key[k] - a.key[k];
    return 0;
  });
  const bySection = new Map<string, Row[]>();
  for (const { row } of scored) bySection.set(row.section, [...(bySection.get(row.section) ?? []), row]);
  return [...bySection.values()].flat();
}

/** A piece of a row's text with its matches marked; `from` is where the piece starts. */
function Marked({ text, spans, from }: { text: string; spans: [number, number][]; from: number }) {
  const parts: React.ReactNode[] = [];
  let i = 0;
  for (const [a, b] of spans) {
    const s = Math.max(a - from, i);
    const e = Math.min(b - from, text.length);
    if (e <= s) continue;
    if (s > i) parts.push(text.slice(i, s));
    parts.push(<mark key={s}>{text.slice(s, e)}</mark>);
    i = e;
  }
  if (i < text.length) parts.push(text.slice(i));
  return <>{parts}</>;
}

export default function WorktreePalette({ projects, items, prOf, atOf, recent, scope, hasWorktree, onWorktree, onCreate, onClose, linked, hosts, onItem }: Props) {
  const [lists, setLists] = useState<Record<string, Worktree[]>>({});
  const [query, setQuery] = useState("");
  const [refused, setRefused] = useState(false);
  const [at, setAt] = useState(0);
  // VIEW-040: ages move on only while the palette is open; closed, it does no status work at all.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  const [chips, setChips] = useState<Chip[]>(() => scope.map((value) => ({ field: "repo", value })));
  // VIEW-039: 20 rows a section, 20 more at a time; focus goes back to where the palette was opened from.
  const [extra, setExtra] = useState<Record<string, number>>({});
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    return () => queueMicrotask(() => void restoreFocus(prev, (s) => document.querySelector<HTMLElement>(s)));
  }, []);

  useEffect(() => {
    let live = true;
    (async () => {
      const next: Record<string, Worktree[]> = Object.fromEntries(
        await Promise.all(projects.map(async (p) => [p.id, await invoke<Worktree[]>("workspace_list", { projectId: p.id }).catch(() => [])] as const)),
      );
      if (live) setLists(next);
    })();
    return () => {
      live = false;
    };
  }, [projects]);

  const typed = query.trim() !== "";
  const pasted = useMemo(
    () => (onItem ? pastedItems(query, linked ?? {}, hosts ?? ["github.com"], (d) => Object.values(lists).flat().find((w) => sameDir(w.path, d)), onItem, onWorktree) : []).map((p): Row => ({ ...p, spans: [], off: false })),
    [query, linked, hosts, lists, onItem],
  );
  const { shown: found, more } = useMemo(
    () => capRows(paletteRows(chipFilter(withRepos([...items, ...worktreeItems(projects, lists, typed, prOf, onWorktree, atOf)], lists), chips), query, recent, hasWorktree), extra),
    [items, projects, lists, query, chips, hasWorktree, extra],
  );
  const rows = useMemo(() => [...pasted, ...found], [pasted, found]);
  const create = typed ? query.trim() : null;
  const item = create ? workItem(create) : null;
  const repoChips = chips.filter((c) => c.field === "repo");
  const into = repoChips.length === 1 ? (projects.find((p) => p.id === repoChips[0].value) ?? null) : null;
  const count = rows.length + (create ? 1 : 0);
  // PROJ-037: an issue or pull request address has the create row picked; other text leaves the
  // first match picked.
  const cur = Math.min(at, count - 1);
  const go = (i: number) => {
    if (i < rows.length && rows[i].off) return;
    onClose();
    if (i < rows.length) rows[i].run();
    else if (create) onCreate(create, into?.id ?? null);
  };
  const setText = (v: string) => {
    if (v.length > MAX_QUERY) return setRefused(true);
    setRefused(false);
    setExtra({});
    setQuery(v);
    setAt(workItem(v) && !(onItem && githubItem(v, hosts ?? ["github.com"])) ? Infinity : 0);
  };
  const chipLabel = (c: Chip) => (c.field === "repo" ? `Repository: ${projects.find((p) => p.id === c.value)?.name ?? c.value}` : `Kind: ${c.value}`);
  const addChip = (c: Chip) => {
    if (!chips.some((x) => x.field === c.field && x.value === c.value)) setChips([...chips, c]);
    setAt(0);
  };

  return (
    <>
      <div className="menu-backdrop" onMouseDown={onClose} />
      <div className="menu note-picker palette" role="dialog" aria-label="Switch worktree">
        <input
          autoFocus
          className="picker-input"
          placeholder="Jump to a worktree, tab, project or setting"
          value={query}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            const chord = chordRow(e.nativeEvent);
            if (chord !== null) {
              if (chord < count) go(chord);
            } else if (e.key === "Escape") onClose();
            else if (e.key === "Enter") count > 0 && go(cur);
            else if (e.key === "ArrowDown") setAt(Math.min(cur + 1, count - 1));
            else if (e.key === "ArrowUp") setAt(Math.max(cur - 1, 0));
            else return;
            e.preventDefault();
            e.stopPropagation();
          }}
        />
        <div className="palette-chips">
          {chips.map((c) => (
            <button key={`${c.field}|${c.value}`} className="palette-chip" aria-label={`Remove the filter ${chipLabel(c)}`} onClick={() => setChips(chips.filter((x) => x !== c))}>
              {chipLabel(c)} ×
            </button>
          ))}
          <select aria-label="Filter by repository" value="" onChange={(e) => e.target.value && addChip({ field: "repo", value: e.target.value })}>
            <option value="">+ Repository</option>
            {repoOptions(projects, lists)
              .filter((o) => !repoChips.some((c) => c.value === o.id))
              .map((o) => (
                <option key={o.id} value={o.id}>{`${o.name} (${o.count})`}</option>
              ))}
          </select>
          <select aria-label="Filter by kind" value="" onChange={(e) => e.target.value && addChip({ field: "section", value: e.target.value })}>
            <option value="">+ Kind</option>
            {SECTIONS.filter((s) => !chips.some((c) => c.field === "section" && c.value === s)).map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        {refused && <div className="menu-hint warn">That is too long to search; the palette takes up to {MAX_QUERY} characters.</div>}
        <div className="picker-list" role="listbox">
          {rows.map((r, i) => {
            const folder = [r.hint, r.parent].filter(Boolean).join(" · ");
            return (
              <Fragment key={`${r.section}|${r.label}|${r.hint ?? ""}|${r.parent ?? ""}|${i}`}>
                {(i === 0 || rows[i - 1].section !== r.section) && <div className="palette-section">{r.section}</div>}
                <button role="option" aria-selected={i === cur} aria-disabled={r.off} className={`menu-item${i === cur ? " at" : ""}${r.off ? " off" : ""}`} title={r.off ? "Open a worktree first" : undefined} aria-keyshortcuts={i < 9 ? `Alt+${i + 1}` : undefined} onMouseEnter={() => setAt(i)} onClick={() => go(i)}>
                  {i < 9 && (
                    <span className="palette-num" aria-hidden="true">
                      {i + 1}
                    </span>
                  )}
                  <RowMark mark={r.mark ?? null} since={r.since ?? 0} now={now} />
                  <span className="name">
                    <Marked text={r.label} spans={r.spans} from={0} />
                  </span>
                  {folder && (
                    <span className="picker-folder">
                      <Marked text={folder} spans={r.spans} from={r.label.length + (r.hint ? 1 : 3)} />
                    </span>
                  )}
                  {r.off && <span className="reason">needs an open worktree</span>}
                </button>
                {(i === rows.length - 1 || rows[i + 1].section !== r.section) && (more[r.section] ?? 0) > 0 && (
                  <button className="menu-item palette-more" title={moreTitle(more[r.section])} onClick={() => setExtra({ ...extra, [r.section]: (extra[r.section] ?? 0) + 1 })}>
                    {moreLabel(more[r.section])}
                  </button>
                )}
              </Fragment>
            );
          })}
          {create && (
            <>
              {rows.length === 0 && <div className="menu-hint">Nothing matches.</div>}
              <button role="option" aria-selected={cur === rows.length} className={`menu-item${cur === rows.length ? " at" : ""}`} onMouseEnter={() => setAt(rows.length)} onClick={() => go(rows.length)}>
                <span className="name">{item ? `Create workspace from ${item.kind === "pull" ? "pull request" : "issue"} #${item.number}` : `Create workspace “${create}”`}</span>
                {item ? <span className="picker-folder">{`${item.owner}/${item.repo}, named after its title and linked to it`}</span> : into && <span className="picker-folder">{`in ${into.name}`}</span>}
              </button>
            </>
          )}
        </div>
      </div>
    </>
  );
}

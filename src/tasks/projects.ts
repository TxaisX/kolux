// T-314-c: GitHub Projects in Tasks (GIT-056 editable table, GIT-057 roadmap views): what the page
// knows about a project, as github.rs reads it, and the pure rules the table is drawn by.

export type FieldOption = { id: string; name: string; start: string; days: number };
export type ProjectField = { id: string; name: string; kind: string; options: FieldOption[] };
export type ProjectView = { number: number; name: string; layout: string };
export type Cell = { text: string; id: string; start: string; days: number };
export type ProjectItem = { id: string; kind: string; title: string; number: number | null; url: string; repo: string; state: string; labels: string[]; assignees: string[]; issueType: string; values: Record<string, Cell> };
export type Project = { id: string; owner: string; number: number; title: string; url: string; closed: boolean; views: ProjectView[]; fields: ProjectField[]; items: ProjectItem[]; more: boolean };
/** A remembered project (pinned or recent). */
export type ProjectRef = { host: string; owner: string; number: number; title: string };

const LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9_]|-(?=[A-Za-z0-9_]))*$/;

const PROJECT_URL = /^https:\/\/([A-Za-z0-9.:-]+)\/(?:orgs|users)\/([^/\s]+)\/projects\/(\d+)(?:\/views\/(\d+))?\/?(?:[?#].*)?$/;

/** FIX-1 (council FB 1): the host of a pasted project address when it is neither github.com nor this
 * workspace's own host, which Kolux does not open (gh would send it a request, maybe with an
 * Enterprise token); null otherwise. */
export function projectHostRefused(text: string, host: string): string | null {
  const h = PROJECT_URL.exec(text.trim())?.[1]?.toLowerCase();
  return h && h !== "github.com" && h !== host.toLowerCase() ? h : null;
}

/** GIT-056: a pasted project URL (`https://<host>/orgs|users/<owner>/projects/<n>[/views/<v>]`) on
 * github.com or this workspace's own host, or an owner and number (`acme 3`, `acme/3`, `acme#3`);
 * null when it is neither. */
export function parseProjectRef(text: string, host: string): { host: string; owner: string; number: number; view: number | null } | null {
  const t = text.trim();
  if (projectHostRefused(t, host)) return null;
  const url = PROJECT_URL.exec(t);
  const short = /^@?([^/\s#]+)\s*[\s/#]\s*(\d+)$/.exec(t);
  const [h, owner, n, v] = url ? [url[1], url[2], url[3], url[4]] : short ? [host, short[1], short[2], undefined] : [];
  if (!owner || !n || !LOGIN.test(owner) || owner.length > 79) return null;
  const number = Number(n);
  if (!Number.isSafeInteger(number) || number < 1) return null;
  return { host: h!.toLowerCase(), owner, number, view: v ? Number(v) : null };
}

/** FIX-1 (council FS 1): one saved cell written onto the row as it is now (not as it was when the edit
 * began), so two edits on one row that finish one after the other both stay. An empty value clears. */
export function applyCellEdit(p: Project, itemId: string, field: ProjectField, value: string): Project {
  const v = value.trim();
  const option = field.options.find((o) => o.id === v);
  const cell = v === "" ? null : option ? { text: option.name, id: option.id, start: option.start, days: option.days } : { text: v, id: "", start: field.kind === "date" ? v : "", days: 0 };
  return {
    ...p,
    items: p.items.map((x) => {
      if (x.id !== itemId) return x;
      const values = { ...x.values };
      if (cell) values[field.id] = cell;
      else delete values[field.id];
      return { ...x, values };
    }),
  };
}

export const projectKey = (r: { host: string; owner: string; number: number }) => `${r.host}/${r.owner.toLowerCase()}/${r.number}`;

/** GIT-056 / GIT-057: how Kolux shows a view layout. The picker and the view both read this one
 * answer, so they always agree: tables as tables, roadmaps as a timeline (T-549, OD-15 flipped),
 * boards not supported. */
export function viewSupport(layout: string): "table" | "timeline" | "unsupported" {
  return layout === "table" ? "table" : layout === "roadmap" ? "timeline" : "unsupported";
}

export function viewLabel(v: ProjectView): string {
  const how = viewSupport(v.layout);
  return how === "table" ? v.name : how === "timeline" ? `${v.name} (timeline)` : `${v.name} (${v.layout}, not supported)`;
}

/** The view a project opens on: the remembered one, else the first table view, else the first. */
export function openingView(p: Pick<Project, "views">, remembered: number | null | undefined): number | null {
  if (remembered != null && p.views.some((v) => v.number === remembered)) return remembered;
  return (p.views.find((v) => viewSupport(v.layout) === "table") ?? p.views[0])?.number ?? null;
}

/** Recent projects: the newest first, each once, at most 8. */
export function pushRecent(list: ProjectRef[], r: ProjectRef, max = 8): ProjectRef[] {
  return [r, ...list.filter((x) => projectKey(x) !== projectKey(r))].slice(0, max);
}

export function togglePin(list: ProjectRef[], r: ProjectRef): ProjectRef[] {
  return list.some((x) => projectKey(x) === projectKey(r)) ? list.filter((x) => projectKey(x) !== projectKey(r)) : [...list, r];
}

/** Settings hold lists the page wrote; anything malformed is dropped rather than trusted. */
export function refsFrom(v: unknown): ProjectRef[] {
  if (!Array.isArray(v)) return [];
  return v.filter((r): r is ProjectRef => !!r && typeof r.host === "string" && typeof r.owner === "string" && LOGIN.test(r.owner) && Number.isSafeInteger(r.number) && r.number > 0).map((r) => ({ host: r.host, owner: r.owner, number: r.number, title: typeof r.title === "string" ? r.title : "" }));
}

/** Kinds whose cell is edited through the project's own field (github_project_set). */
export const EDITABLE = new Set(["text", "number", "date", "single_select", "iteration"]);
/** T-314-d: columns that are the issue's own fields, edited on the issue and not through the project:
 * labels (scm_task_labels), assignees (pr_assignees: GitHub keeps both under issues) and the issue
 * type (github_issue_type_set, issues only: a pull request has none). */
const onIssue = (item: ProjectItem) => item.kind !== "draft" && item.kind !== "restricted" && !!item.repo && item.number !== null;
export const cellEditable = (item: ProjectItem, f: ProjectField) =>
  item.kind !== "restricted" && (EDITABLE.has(f.kind) || ((f.kind === "labels" || f.kind === "assignees") && onIssue(item)) || (f.kind === "issue_type" && item.kind === "issue" && onIssue(item)));

/** What a cell shows. */
export function cellText(item: ProjectItem, f: ProjectField): string {
  if (item.kind === "restricted") return "";
  switch (f.kind) {
    case "title":
      return item.title;
    case "assignees":
      return item.assignees.map((a) => `@${a}`).join(", ");
    case "labels":
      return item.labels.join(", ");
    case "issue_type":
      return item.issueType;
    case "repository":
      return item.repo;
    default:
      return item.values[f.id]?.text ?? "";
  }
}

/** GIT-056: sort by a column; numbers by value, single-select and iterations in the project's own
 * option order, dates and text as text; empty cells and restricted items always last. */
export function sortItems(items: ProjectItem[], f: ProjectField, dir: 1 | -1): ProjectItem[] {
  const rank = (it: ProjectItem): number | string | null => {
    const t = cellText(it, f);
    if (it.kind === "restricted" || t === "") return null;
    if (f.kind === "number") return Number(t);
    if (f.kind === "single_select" || f.kind === "iteration") {
      const id = it.values[f.id]?.id;
      if (f.kind === "iteration") return it.values[f.id]?.start || t;
      const i = f.options.findIndex((o) => o.id === id);
      return i < 0 ? t : i;
    }
    return t.toLowerCase();
  };
  return items
    .map((it, i) => ({ it, i, r: rank(it) }))
    .sort((a, b) => {
      if (a.r === null || b.r === null) return a.r === b.r ? a.i - b.i : a.r === null ? 1 : -1;
      const c = a.r < b.r ? -1 : a.r > b.r ? 1 : 0;
      return c * dir || a.i - b.i;
    })
    .map((x) => x.it);
}

/** Fields a table can group by. */
export const GROUPABLE = new Set(["single_select", "iteration", "repository"]);

/** GIT-056: rows grouped by a column, groups in the field's option order (repositories by name),
 * with the rows that have no value last as "No <field>". */
export function groupItems(items: ProjectItem[], f: ProjectField): { key: string; label: string; items: ProjectItem[] }[] {
  const groups = new Map<string, { key: string; label: string; items: ProjectItem[] }>();
  for (const it of items) {
    const label = cellText(it, f);
    const key = f.kind === "repository" ? label : (it.values[f.id]?.id ?? "");
    const g = groups.get(key) ?? { key, label: label || `No ${f.name.toLowerCase()}`, items: [] };
    g.items.push(it);
    groups.set(key, g);
  }
  const order = (k: string) => (k === "" ? Number.MAX_SAFE_INTEGER : f.kind === "repository" ? 0 : f.options.findIndex((o) => o.id === k));
  return [...groups.values()].sort((a, b) => order(a.key) - order(b.key) || a.label.localeCompare(b.label));
}

/** GIT-056: limit rows to repositories open in Kolux, or to the chosen ones. Drafts and restricted
 * items name no repository, so a limit leaves them out. */
export type Scope = { mode: "all" } | { mode: "kolux" } | { mode: "chosen"; repos: string[] };
export function scopeItems(items: ProjectItem[], scope: Scope, inKolux: string[]): ProjectItem[] {
  if (scope.mode === "all") return items;
  const allowed = new Set((scope.mode === "kolux" ? inKolux : scope.repos).map((r) => r.toLowerCase()));
  return items.filter((it) => it.repo && allowed.has(it.repo.toLowerCase()));
}

/** The repositories ticked when "Chosen repositories" is picked: those of this project that are open in Kolux;
 *  when none is, all of the project's repositories, so the table is never empty before the user has chosen. */
export function chosenDefault(repos: string[], inKolux: string[]): string[] {
  const here = new Set(inKolux.map((r) => r.toLowerCase()));
  const open = repos.filter((r) => here.has(r.toLowerCase()));
  return open.length > 0 ? open : [...repos];
}

/** A label edit as GitHub's add / remove lists, from the typed comma list. */
export function labelChange(before: string[], typed: string): { add: string[]; remove: string[] } {
  const after = [...new Set(typed.split(",").map((s) => s.trim()).filter(Boolean))];
  const low = (l: string[]) => new Set(l.map((x) => x.toLowerCase()));
  const was = low(before);
  const now = low(after);
  return { add: after.filter((l) => !was.has(l.toLowerCase())), remove: before.filter((l) => !now.has(l.toLowerCase())) };
}

/** T-314-d: an assignee edit as GitHub's add / remove lists, from the typed comma list (`@ana, bo`).
 * Logins compare without regard to case; a typed name that is not a GitHub login is listed in `bad`
 * and nothing is sent while there is one. */
export function assigneeChange(before: string[], typed: string): { add: string[]; remove: string[]; bad: string[] } {
  const named = typed.split(",").map((s) => s.trim().replace(/^@/, "")).filter(Boolean);
  const after = [...new Map(named.map((n) => [n.toLowerCase(), n])).values()];
  const bad = after.filter((n) => !LOGIN.test(n) || n.length > 79);
  const was = new Set(before.map((x) => x.toLowerCase()));
  const now = new Set(after.map((x) => x.toLowerCase()));
  return { add: after.filter((l) => !was.has(l.toLowerCase())), remove: before.filter((l) => !now.has(l.toLowerCase())), bad };
}

/** T-314-d: the address a repository is cloned from when a row offers to add it (GIT-056): https on a
 * plain host name and a plain owner/name, otherwise null. */
export function cloneAddress(host: string, repo: string): string | null {
  const part = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
  const [owner, name, ...rest] = repo.split("/");
  if (!/^[A-Za-z0-9][A-Za-z0-9.-]*(?::\d{1,5})?$/.test(host) || rest.length > 0 || !owner || !name || !part.test(owner) || !part.test(name)) return null;
  return `https://${host}/${owner}/${name}.git`;
}

/** T-314-d: the assignees a row shows once an edit succeeded. */
export function applyAssignees(before: string[], change: { add: string[]; remove: string[] }): string[] {
  const gone = new Set(change.remove.map((x) => x.toLowerCase()));
  const kept = before.filter((x) => !gone.has(x.toLowerCase()));
  return [...kept, ...change.add.filter((a) => !kept.some((k) => k.toLowerCase() === a.toLowerCase()))];
}

/** The view's address on GitHub, only for a project GitHub gave an https address. */
export function viewUrl(p: Pick<Project, "url">, view: number | null): string | null {
  if (!/^https:\/\/[^\s"'<>]+$/.test(p.url)) return null;
  return view === null ? p.url : `${p.url.replace(/\/$/, "")}/views/${view}`;
}

// FIX-2 (council AFTER 3): each cell edit has its own id, so two edits to the same cell keep their
// own "saving…" mark, and a reply that comes back after a newer edit to that cell was sent is not
// applied over it.
export type Saving = { id: number; cell: string };
export const cellKey = (item: string, field: string) => `${item} ${field}`;
export const startSave = (s: Saving[], id: number, cell: string): Saving[] => [...s, { id, cell }];
export const endSave = (s: Saving[], id: number): Saving[] => s.filter((x) => x.id !== id);
export const isSaving = (s: Saving[], cell: string) => s.some((x) => x.cell === cell);
/** FIX-3 (review FIX-SOON 4): the edits sent for each cell. The cell shows the value of the last
 * edit that succeeded, once no edit for it is still out; so a newer edit that fails leaves the cell
 * on the older value GitHub really holds, and an older edit that comes back late is never put over
 * a newer success. */
export type CellBook = { pending: Map<string, Set<number>>; best: Map<string, { id: number; apply: () => void }>; wins: Map<string, number>; sent: number; due: boolean };
export const newBook = (): CellBook => ({ pending: new Map(), best: new Map(), wins: new Map(), sent: 0, due: false });
export function sendEdit(b: CellBook, cell: string, id: number): void {
  b.sent++;
  const set = b.pending.get(cell) ?? new Set<number>();
  set.add(id);
  b.pending.set(cell, set);
}
/** FIX-5 (review AFTER 4): the burst re-read replaces the whole project with what GitHub held when
 * the read was answered, so it must never run over an edit of another cell that is out, or was sent
 * after the read. `readBackStart` gives a token to send the read with, or null (no read) while any
 * edit is still out; `readBackFresh` says whether the answer may still be shown (no edit has been
 * sent since the token was given, and none is out now).
 * FIX-6 (council FIX-SOON 1): a read that is skipped or dropped is not forgotten: `due` stays set
 * until a read is sent, `settleEdit` reports "read now" when the last pending edit settles, and
 * `readBackLost` says whether a dropped answer should be read again at once. */
export const editsOut = (b: CellBook): boolean => [...b.pending.values()].some((s) => s.size > 0);
export function readBackStart(b: CellBook): number | null {
  if (editsOut(b)) {
    b.due = true;
    return null;
  }
  b.due = false;
  return b.sent;
}
export const readBackFresh = (b: CellBook, token: number): boolean => b.sent === token && !editsOut(b);
/** The answer to a read was dropped (an edit went out since): true when no edit is out now, so the
 * caller reads again at once; false when one is, and that edit's settle will ask for the read. */
export function readBackLost(b: CellBook): boolean {
  b.due = true;
  return !editsOut(b);
}
/** An edit came back. `apply` shows its value; it runs (for the highest-numbered success) when the last edit for the cell settles.
 * FIX-4 (review AFTER 6): returns true when that was a burst (two or more edits went through): the
 * highest id wins on screen only on the assumption that GitHub applied them in the order sent, so
 * the caller reads the item back to show what GitHub really holds. FIX-6: a burst whose read has to
 * wait for another edit that is out sets `due`; the settle that leaves no edit out returns true. */
export function settleEdit(b: CellBook, cell: string, id: number, ok: boolean, apply: () => void): boolean {
  const set = b.pending.get(cell);
  set?.delete(id);
  const cur = b.best.get(cell);
  if (ok && (!cur || cur.id < id)) b.best.set(cell, { id, apply });
  if (ok) b.wins.set(cell, (b.wins.get(cell) ?? 0) + 1);
  if (set && set.size > 0) return false;
  b.pending.delete(cell);
  const best = b.best.get(cell);
  b.best.delete(cell);
  const burst = (b.wins.get(cell) ?? 0) >= 2;
  b.wins.delete(cell);
  best?.apply();
  if (burst) b.due = true;
  if (!b.due || editsOut(b)) return false;
  b.due = false;
  return true;
}

// SKILL-017: what the Skills page shows, worked out from one scan (src-tauri/src/skills.rs).

export type Source = "home" | "workspace" | "bundled" | "plugin";
export type AgentId = "claude" | "codex" | "grok" | "hermes" | "shared";

export type Skill = {
  name: string;
  description: string | null;
  updated: number | null;
  path: string;
  source: Source;
  agents: AgentId[];
  plugin: string | null;
};

export type Root = {
  path: string;
  label: string;
  source: Source;
  agents: AgentId[];
  state: "scanned" | "partial" | "not-found" | "not-scanned" | "error";
  count: number;
  note: string | null;
};

export type Scan = { skills: Skill[]; roots: Root[] };

export const SOURCES: Array<{ id: Source; label: string }> = [
  { id: "home", label: "Home" },
  { id: "workspace", label: "Workspace" },
  { id: "bundled", label: "Bundled" },
  { id: "plugin", label: "Plugin" },
];

/** The Filter by agent menu: all agents, each AI, and the shared skills folder. */
export const AGENT_FILTERS: Array<{ id: "all" | AgentId; label: string }> = [
  { id: "all", label: "All agents" },
  { id: "claude", label: "Claude Code" },
  { id: "codex", label: "Codex" },
  { id: "grok", label: "Grok" },
  { id: "hermes", label: "Hermes" },
  { id: "shared", label: "Shared skills folder" },
];

/** A pasted search longer than this is refused. */
export const QUERY_LIMIT = 200;

export type Filters = { query: string; agent: "all" | AgentId; sources: Source[] };
export const NO_FILTERS: Filters = { query: "", agent: "all", sources: [] };

export const filtersOn = (f: Filters) => f.query.trim() !== "" || f.agent !== "all" || f.sources.length > 0;

/** Every typed word has to appear in the name, description or path, ignoring case. */
function matches(s: Skill, query: string): boolean {
  const hay = `${s.name}\n${s.description ?? ""}\n${s.path}`.toLowerCase();
  return query.toLowerCase().split(/\s+/).filter(Boolean).every((w) => hay.includes(w));
}

/** The rows left after the agent filter, the source chips and the search. */
export function visible(skills: Skill[], f: Filters): Skill[] {
  return skills.filter((s) => (f.agent === "all" || s.agents.includes(f.agent)) && (f.sources.length === 0 || f.sources.includes(s.source)) && matches(s, f.query));
}

/** Each source chip's count, after the agent filter and search but before the chips themselves. */
export function sourceCounts(skills: Skill[], f: Filters): Record<Source, number> {
  const out: Record<Source, number> = { home: 0, workspace: 0, bundled: 0, plugin: 0 };
  for (const s of visible(skills, { ...f, sources: [] })) out[s.source] += 1;
  return out;
}

/** Long paths keep their start and their last two parts, with an ellipsis between. */
export function shortPath(p: string, max = 64): string {
  if (p.length <= max) return p;
  const sep = p.includes("\\") ? "\\" : "/";
  const parts = p.split(sep);
  const tail = parts.slice(-2).join(sep);
  const head = parts.slice(0, 2).join(sep);
  const short = `${head}${sep}…${sep}${tail}`;
  return short.length < p.length && short.length <= max + 8 ? short : `…${p.slice(-(max - 1))}`;
}

export const NO_DESCRIPTION = "No description";
export const NO_DATE = "Date unknown";

export function dateText(ms: number | null, loc?: string): string {
  return ms == null ? NO_DATE : new Date(ms).toLocaleDateString(loc, { year: "numeric", month: "short", day: "numeric" });
}

/** What the folders popover says about one root. */
export function rootState(r: Root): string {
  const n = `${r.count} skill${r.count === 1 ? "" : "s"}`;
  switch (r.state) {
    case "scanned":
      return n;
    case "partial":
      return `${n}, partly scanned${r.note ? `: ${r.note}` : ""}`;
    case "not-found":
      return "Not found";
    case "not-scanned":
      return `Not scanned${r.note ? `: ${r.note}` : ""}`;
    case "error":
      return `Scan failed${r.note ? `: ${r.note}` : ""}`;
  }
}

/** The page's state. A root that failed makes the whole scan a failure, never a shorter list. */
export type View = "scanning" | "failed" | "empty" | "no-matches" | "list";
export function viewOf(scan: Scan | null, failed: string | null, scanning: boolean, shown: number): View {
  if (failed || scan?.roots.some((r) => r.state === "error")) return "failed";
  if (!scan) return scanning ? "scanning" : "failed";
  if (scan.skills.length === 0) return scanning ? "scanning" : "empty";
  return shown === 0 ? "no-matches" : "list";
}

/** Escape closes the page, but never takes Escape away from a focused input. */
export function escapeCloses(target: EventTarget | null): boolean {
  const el = target as { tagName?: string; isContentEditable?: boolean } | null;
  if (!el) return true;
  const tag = (el.tagName ?? "").toUpperCase();
  return !(tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable);
}

// SKILL-022: Delete skills. The page chooses rows, asks the app for a plan (skill_delete.rs),
// shows the confirmation from it, then shows each skill's outcome.

/** One delete request covers between 1 and this many skills. */
export const MAX_DELETE = 512;

/** Bundled and plugin skills cannot be chosen. */
export const canDelete = (s: Skill) => s.source === "home" || s.source === "workspace";

/** A chosen skill, by the path and change time the list showed (a later change blocks it). */
export type Pick = { path: string; updated: number | null };
export const pickOf = (s: Skill): Pick => ({ path: s.path, updated: s.updated });

export type Blocked = "bundled" | "plugin" | "outside" | "gone" | "changed" | "unreadable";
export type Planned = { path: string; blocked: Blocked | null; items: { path: string; kind: "folder" | "link" | "receipt" }[]; remains: string | null; dangling?: string[] };
export type Outcome = "deleted" | "skipped" | "busy" | "partly" | "failed" | "unsure";
export type Done = { path: string; outcome: Outcome; note: string | null };

export const BLOCKED: Record<Blocked, string> = {
  bundled: "Bundled with Kolux, so it would come back",
  plugin: "Put there by a plugin; remove the plugin instead",
  outside: "Outside Kolux's skill folders",
  gone: "No longer on disk",
  changed: "Changed since the list loaded; refresh first",
  unreadable: "WSL did not give a readable answer, so it was left alone; try again",
};

/** Why a row cannot be chosen, or null when it can. */
export const whyNot = (s: Skill): string | null => (canDelete(s) ? null : BLOCKED[s.source === "bundled" ? "bundled" : "plugin"]);

/** Select all eligible: only the shown rows that can be chosen. */
export const eligible = (shown: Skill[]) => shown.filter(canDelete).map((s) => s.path);

/** After a rescan, choices that disappeared or can no longer be chosen are dropped. */
export function keepChosen(chosen: string[], skills: Skill[]): string[] {
  const ok = new Set(skills.filter(canDelete).map((s) => s.path));
  return chosen.filter((p) => ok.has(p));
}

const many = (n: number, one: string, more = `${one}s`) => `${n} ${n === 1 ? one : more}`;

/** The confirmation's sum-up: what goes, where content stays, and what is blocked and why. */
export function sumUp(plan: Planned[], nameOf: (path: string) => string) {
  const going = plan.filter((p) => !p.blocked);
  const items = going.flatMap((p) => p.items);
  const folders = items.filter((i) => i.kind === "folder").length;
  const links = items.filter((i) => i.kind === "link").length;
  const parts = [folders ? many(folders, "folder") : "", links ? many(links, "link") : ""].filter(Boolean).join(" and ");
  return {
    count: going.length,
    headline: going.length === 0 ? "None of the chosen skills can be deleted." : `${many(going.length, "skill")} will be deleted: ${parts} removed across all skill folders.`,
    remains: going.filter((p) => p.remains).map((p) => `${nameOf(p.path)}: only a link is removed; the content stays in ${p.remains}`),
    dangling: going.flatMap((p) => (p.dangling ?? []).map((l) => `${nameOf(p.path)}: the link ${l} is outside the skill folders, so it stays and will point at nothing`)),
    blocked: plan.filter((p) => p.blocked).map((p) => `${nameOf(p.path)}: ${BLOCKED[p.blocked!]}`),
  };
}

export const OUTCOME: Record<Outcome, string> = {
  deleted: "Deleted",
  skipped: "Skipped",
  busy: "Busy: another skill operation is under way",
  partly: "Partly removed: hidden staged files are left over",
  failed: "Failed; nothing was changed",
  unsure: "Not confirmed: some of it may already be removed",
};

/** One line of the outcome list. A skipped skill says why; the others add the app's note. */
export function outcomeText(d: Done): string {
  if (d.outcome === "skipped" && d.note && d.note in BLOCKED) return `${OUTCOME.skipped}: ${BLOCKED[d.note as Blocked]}`;
  return d.note && (d.outcome === "failed" || d.outcome === "partly" || d.outcome === "unsure") ? `${OUTCOME[d.outcome]} (${d.note})` : OUTCOME[d.outcome];
}

// SKILL-020: a row's actions and the details dialog.
export type RowAction = "details" | "reveal" | "copy" | "delete";
export const ROW_ACTIONS: Array<{ id: RowAction; label: string }> = [
  { id: "details", label: "View details" },
  { id: "reveal", label: "Reveal file" },
  { id: "copy", label: "Copy path" },
  { id: "delete", label: "Delete" },
];

/** Why a row action cannot run for this skill, or null when it can. A bundled skill has no file
 * on disk to reveal or copy; Delete follows the same rule as choosing for a bulk delete. */
export function actionBlocked(s: Skill, a: RowAction): string | null {
  if (a === "details") return null;
  if (a === "delete") return whyNot(s);
  return s.source === "bundled" ? "Built into Kolux; there is no file on disk" : null;
}

/** The AIs that can use the skill, by name; the shared folder is read by each AI listed with it. */
export function seenBy(s: Skill): string[] {
  if (s.source === "bundled") return ["Kolux (built in)"];
  return s.agents.map((a) => AGENT_FILTERS.find((x) => x.id === a)?.label ?? a);
}

/** The toast Copy path shows, and what it says when the clipboard refuses. */
export const COPIED = "Path copied";
export const COPY_FAILED = "Could not copy; the path is shown in View details to select";

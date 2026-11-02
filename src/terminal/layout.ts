// PROJ-067: the workspaces' tabs and layout are written to the settings as they change and read
// back at start. Only what a fresh start can rebuild is kept: a terminal tab comes back as its
// program in its folder (an agent with its last known session resumed, SESS-030, else at its prompt),
// a browser or editor tab as the same kind on the same path. A saved entry that cannot be read is
// dropped on its own; the rest comes back. A tab whose folder is gone is dropped, and the active
// workspace and tab return only while they still exist.

import type { Agent } from "../chrome/VendorMark";
import { focusIn, panesIn } from "../workspaces";
import { resumeId, uniqueOwners } from "../sessions/ownership";
import { isTabColor, type TabColors } from "./tabColor";

export const LAYOUT_FIELD = "savedLayout";

export type PaneKind = "browser" | "editor" | "preview" | "diff" | "changes";
const KINDS: PaneKind[] = ["browser", "editor", "preview", "diff", "changes"];
const AGENTS: Agent[] = ["claude", "codex", "shell"];

export type SavedPane = {
  key: number;
  cwd: string | null;
  branch: string | null;
  agent: Agent;
  agentId?: string;
  program: string | null;
  args: string[];
  /** SESS-030: the agent's own session id from its newest hook event; a restart resumes it. */
  session?: string;
  /** ACCT-063: the session this tab was forked from; a fork is never resumed as its source. */
  forkOf?: string;
  /** Never written down: main.tsx fills it from the agent's standing start line at restore. */
  env?: [string, string][];
  /** Never written down: TERM-107, whether main.tsx's restore line carries the agent's resume form. */
  resumed?: boolean;
  account?: string | null;
  title?: string;
  group?: number;
  kind?: PaneKind;
  path?: string;
  staged?: boolean;
  /** after-list #100: a pinned tab and its Tab Color come back after a restart. */
  pinned?: boolean;
  color?: string;
  /** An empty chooser pane (SESS-007): it comes back empty, with its pre-picked agent if it had one. */
  chooser?: true;
};
export type SavedLayout = { panes: SavedPane[]; activeTab: Record<number, number>; focused: number; activeDir: string | null; stacked: Record<string, boolean> };

/** The window state a tab carries besides its program: which tabs are pinned and each tab's colour. */
export type Marks = { pinned: ReadonlySet<number>; colors: TabColors };

/** The pinned tabs and colours the saved panes carry, as App's window state. */
export function marksOf(panes: SavedPane[]): { pinned: Set<number>; colors: TabColors } {
  const colors: TabColors = {};
  for (const p of panes) if (p.color !== undefined) colors[p.key] = p.color;
  return { pinned: new Set(panes.filter((p) => p.pinned).map((p) => p.key)), colors };
}

/** A live pane as App keeps it; the fields beyond SavedPane are what a restart cannot rebuild. */
type LivePane = Omit<SavedPane, "env"> & {
  seats?: unknown[];
  env?: unknown;
  typed?: string;
  task?: string;
  /** T-066-e: `session` came from the agent's sessions list, not from the agent itself: a guess (the folder's
   *  newest session when the tab was opened, which may be an older one), replaced by the agent's own exit hint or
   *  a newer listed one. Never written down: a restored tab really runs the id it was restored with. */
  sessionListed?: boolean;
};

/** What to write down: every tab, stripped to what a restart can rebuild. A chooser that was never
 *  started is kept as an empty chooser so the grid keeps its size; an agent comes back at its prompt
 *  (its arguments carried the one-off opening prompt and environment). */
export function layoutOf(panes: LivePane[], activeTab: Record<number, number>, focused: number, activeDir: string | null, stacked: Record<string, boolean>, marks?: Marks): SavedLayout {
  const kept: SavedPane[] = [];
  for (const p of panes) {
    const chooser = !!p.seats && p.program === null && !p.kind;
    const s: SavedPane = { key: p.key, cwd: p.cwd, branch: p.branch, agent: p.agent, program: p.program, args: p.agent === "shell" ? p.args : [] };
    if (chooser) s.chooser = true;
    if (p.agentId !== undefined) s.agentId = p.agentId;
    if (p.session) s.session = p.session;
    if (p.forkOf) s.forkOf = p.forkOf;
    if (p.account !== undefined) s.account = p.account;
    if (p.title !== undefined) s.title = p.title;
    if (p.group !== undefined) s.group = p.group;
    if (p.kind !== undefined) s.kind = p.kind;
    if (p.path !== undefined) s.path = p.path;
    if (p.staged !== undefined) s.staged = p.staged;
    if (marks?.pinned.has(p.key)) s.pinned = true;
    const color = marks?.colors[p.key];
    if (isTabColor(color)) s.color = color;
    kept.push(s);
  }
  return tidy(kept, activeTab, focused, activeDir, stacked);
}

/** The agents whose own status hooks hand Kolux their session id, so their sessions list is never asked. */
export const HOOK_FED_AGENTS: readonly string[] = ["claude", "codex"];
/** The agents with a sessions command of their own (the rows of terminal_session_id.rs SOURCES with a list):
 *  the only ones whose list is asked; the other id-only agents have nothing to run. */
export const LISTED_AGENTS: readonly string[] = ["cursor", "gemini", "hermes", "goose", "amp"];

/** One pane to ask; `own` is the listed guess it already holds, left out of its own ask so the same or a newer id can come back. */
export type ListedAsk = { key: number; agent: string; folder: string; own?: string };

/** T-066-e (SESS-030, source 2 of terminal_session_id.rs): the panes whose session id the window asks the
 * agent's own sessions command for when it writes the layout down: each started tab of an agent with a
 * sessions command (`LISTED_AGENTS`) that holds no session id yet, or only a listed guess (`sessionListed`,
 * so the session the agent made since can replace it), with its folder to run the command in. A chooser never
 * started, a non-terminal tab and a tab with no folder are not asked, nor a hook-fed agent (`HOOK_FED_AGENTS`).
 * `taken` is every session id some pane holds (a listed guess too, for the other panes), and the session each
 * fork came from (a fork is never resumed as its source), so the answer is never a session another pane
 * resumes: the never-twice rule. */
export function panesWantingListedSession(panes: LivePane[]): { asks: ListedAsk[]; taken: string[] } {
  const asks: ListedAsk[] = [];
  const taken: string[] = [];
  for (const p of panes) {
    if (p.session) taken.push(p.session);
    if (p.forkOf && !taken.includes(p.forkOf)) taken.push(p.forkOf);
    const chooser = !!p.seats && p.program === null && !p.kind;
    const settled = !!p.session && !p.sessionListed;
    if (settled || p.kind || chooser || !p.agentId || !p.cwd || HOOK_FED_AGENTS.includes(p.agentId) || !LISTED_AGENTS.includes(p.agentId)) continue;
    const ask: ListedAsk = { key: p.key, agent: p.agentId, folder: p.cwd };
    if (p.session) ask.own = p.session;
    asks.push(ask);
  }
  return { asks, taken };
}

/** T-066-e: the id the agent's sessions list gave for pane `key` goes on it as a guess (`sessionListed`), only while
 *  the pane has no id or a guess; an id the agent named itself (a hook's, its exit hint) is never replaced. */
export function withListedSession<T extends LivePane>(panes: T[], key: number, id: string): T[] {
  return panes.map((p) => (p.key === key && (!p.session || p.sessionListed) && p.session !== id ? { ...p, session: id, sessionListed: true } : p));
}

/** T-066-d/e: the id the agent printed in its own resume hint goes on pane `key`: over no id or a listed guess (the
 *  agent knows its session better than its list, source 1 over source 2), never over a settled id. */
export function withHintedSession<T extends LivePane>(panes: T[], key: number, id: string): T[] {
  return panes.map((p) => (p.key === key && (!p.session || p.sessionListed) ? { ...p, session: id, sessionListed: false } : p));
}

/** A saved pane as App's live pane: a saved chooser gets its seat back (the agent it was pre-set to, else blank). */
export function reviveSaved(p: SavedPane): Omit<SavedPane, "chooser"> & { seats?: { agent: string | null; model: string | null }[] } {
  const { chooser, ...rest } = p;
  return chooser ? { ...rest, seats: [{ agent: p.agentId ?? null, model: null }] } : rest;
}

/** SESS-030 (T-066-c): whether the restore loop asks the Rust side for this tab's start line. Only
 * an agent tab does: a tab with no agent id, a non-terminal tab, and a plain shell (or an unstarted
 * chooser) with no program of its own keep the line they were saved with. A catalogue agent saved as
 * a shell with its own program (Gemini CLI, say) is asked, so its resume form reaches it. */
export function restoreAsks(p: Pick<SavedPane, "agent" | "agentId" | "program" | "kind">): boolean {
  return !p.kind && !!p.agentId && !(p.agent === "shell" && p.program === null);
}

const str = (v: unknown): v is string => typeof v === "string";
const strOrNull = (v: unknown): v is string | null => v === null || typeof v === "string";
const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** One saved entry, or null when it cannot be read. */
function readPane(v: unknown): SavedPane | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (!num(o.key) || o.key < 1 || !strOrNull(o.cwd) || !strOrNull(o.branch) || !AGENTS.includes(o.agent as Agent) || !strOrNull(o.program)) return null;
  if (!Array.isArray(o.args) || !o.args.every(str)) return null;
  const p: SavedPane = { key: o.key, cwd: o.cwd, branch: o.branch, agent: o.agent as Agent, program: o.program, args: o.args as string[] };
  if (o.kind !== undefined) {
    if (!KINDS.includes(o.kind as PaneKind)) return null;
    p.kind = o.kind as PaneKind;
    if (o.kind !== "browser" && o.kind !== "changes" && !str(o.path)) return null;
  }
  if (str(o.agentId)) p.agentId = o.agentId;
  if (str(o.forkOf) && o.forkOf !== "") p.forkOf = o.forkOf;
  const own = resumeId({ session: str(o.session) ? o.session : undefined, forkOf: p.forkOf });
  if (own !== null) p.session = own;
  if (strOrNull(o.account) && o.account !== undefined) p.account = o.account;
  if (str(o.title)) p.title = o.title;
  if (num(o.group)) p.group = o.group;
  if (str(o.path)) p.path = o.path;
  if (typeof o.staged === "boolean") p.staged = o.staged;
  if (o.pinned === true) p.pinned = true;
  if (isTabColor(o.color)) p.color = o.color;
  if (o.chooser === true && !p.kind && p.program === null) p.chooser = true;
  return p;
}

/** Reads a saved layout: entries that cannot be read are dropped and the rest kept; null when
 *  nothing usable was saved. */
export function restoreLayout(value: unknown): SavedLayout | null {
  if (!value || typeof value !== "object") return null;
  const o = value as Record<string, unknown>;
  if (!Array.isArray(o.panes)) return null;
  const seen = new Set<number>();
  const panes: SavedPane[] = [];
  for (const v of o.panes) {
    const p = readPane(v);
    if (p && !seen.has(p.key)) {
      seen.add(p.key);
      panes.push(p);
    }
  }
  if (panes.length === 0) return null;
  const activeTab: Record<number, number> = {};
  if (o.activeTab && typeof o.activeTab === "object") {
    for (const [g, k] of Object.entries(o.activeTab as Record<string, unknown>)) if (num(k)) activeTab[Number(g)] = k;
  }
  const stacked: Record<string, boolean> = {};
  if (o.stacked && typeof o.stacked === "object") {
    for (const [d, s] of Object.entries(o.stacked as Record<string, unknown>)) if (typeof s === "boolean") stacked[d] = s;
  }
  // after-list #723: the panes keep the order they were saved in (a split-in pane sits before an older one, so key order is not screen order);
  // VIEW-107 (T-069-c): main.tsx asks the start lines in session (key) order instead.
  return tidy(uniqueOwners(panes), activeTab, num(o.focused) ? o.focused : 0, strOrNull(o.activeDir) ? o.activeDir : null, stacked);
}

/** Drops the tabs whose folder is gone; the active workspace and tab come back only while they exist. */
export function stillThere(l: SavedLayout, exists: (dir: string) => boolean): SavedLayout {
  const panes = l.panes.filter((p) => p.cwd === null || exists(p.cwd));
  const activeDir = l.activeDir !== null && !exists(l.activeDir) ? null : l.activeDir;
  return tidy(panes, l.activeTab, l.focused, activeDir, l.stacked);
}

/** Keeps the bookkeeping consistent with the panes: the active tab of each cell and the focus name
 *  panes that exist (the focus falls to the first pane of the active workspace, then any pane). */
function tidy(panes: SavedPane[], activeTab: Record<number, number>, focused: number, activeDir: string | null, stacked: Record<string, boolean>): SavedLayout {
  const keys = new Set(panes.map((p) => p.key));
  const tabs: Record<number, number> = {};
  for (const [g, k] of Object.entries(activeTab)) if (keys.has(k)) tabs[Number(g)] = k;
  let f = keys.has(focused) ? focused : focusIn(panes, activeDir, focused);
  if (!keys.has(f)) f = panesIn(panes, activeDir)[0]?.key ?? panes[0]?.key ?? 1;
  return { panes, activeTab: tabs, focused: f, activeDir, stacked };
}

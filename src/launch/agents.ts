// Which agents the plus menu offers (SESS-001, SESS-004): only the installed ones, the default
// agent first, the rest in catalogue order. Pure, so it is tested without a browser.
import type { AgentInfo } from "./PlusMenu";

/** The settings key that names the default agent by its stable id. */
export const DEFAULT_AGENT_KEY = "defaultAgent";

/** The default agent's id from the settings object; "" (no default, so lists keep catalogue order)
 * on a fresh install (SESS-010) and once it was cleared, as switching the default agent off does (SET-027). */
export function defaultAgentId(settings: Record<string, unknown> | null | undefined): string {
  const v = settings?.[DEFAULT_AGENT_KEY];
  return typeof v === "string" ? v : "";
}

/** The settings key listing the agents switched off on the Agents page (SET-027). */
export const DISABLED_AGENTS_KEY = "disabledAgents";

export function disabledAgents(settings: Record<string, unknown> | null | undefined): string[] {
  const v = settings?.[DISABLED_AGENTS_KEY];
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

/** The agents offered everywhere but Settings: the switched-off ones are left out. */
export function offeredAgents(agents: AgentInfo[], settings: Record<string, unknown> | null | undefined): AgentInfo[] {
  const off = disabledAgents(settings);
  return off.length === 0 ? agents : agents.filter((a) => !off.includes(a.id));
}

/** The settings after switching agent `id` on or off; switching off the default leaves no default. */
export function switchAgent(settings: Record<string, unknown>, id: string, on: boolean): Record<string, unknown> {
  const off = disabledAgents(settings).filter((x) => x !== id);
  const next: Record<string, unknown> = { ...settings, [DISABLED_AGENTS_KEY]: on ? off : [...off, id] };
  if (!on && defaultAgentId(settings) === id) next[DEFAULT_AGENT_KEY] = "";
  return next;
}

/** SESS-003: some agent is installed, yet every installed one is switched off. */
export function allSwitchedOff(all: AgentInfo[], settings: Record<string, unknown> | null | undefined): boolean {
  const installed = all.filter((a) => a.installed);
  return installed.length > 0 && offeredAgents(installed, settings).length === 0;
}

/** SESS-002: where the agent search stands. Nothing counts as not installed before the first
 * pass is done, and an errored pass blocks launching until one succeeds. */
export type AgentPass = { looking: boolean; done: boolean; error: string | null; slow?: boolean }; // job 78 R73-3: `slow`, a later search took too long; Start keeps the last list
export const FIRST_PASS: AgentPass = { looking: true, done: false, error: null };
export const canLaunch = (p: AgentPass): boolean => p.done && p.error === null;

/** Installed agents with the default first and the others in catalogue order. */
export function menuAgents(agents: AgentInfo[], defaultId: string): AgentInfo[] {
  const installed = agents.filter((a) => a.installed);
  const first = installed.find((a) => a.id === defaultId);
  return first ? [first, ...installed.filter((a) => a !== first)] : installed;
}

/** SESS-009: the three agents the dropdown leads with, in this order. */
export const FEATURED = ["claude", "codex", "grok"];
/** SESS-009: a search longer than this is ignored, so the list stays quick. */
export const MAX_SEARCH = 40;

/** SESS-009: the rows shown before "Show more agents" (`top`) and the folded rest (`more`). The
 *  default leads (SESS-004), then the installed featured agents; with none of those installed
 *  nothing is folded. */
export function agentRows(agents: AgentInfo[], defaultId: string): { top: AgentInfo[]; more: AgentInfo[] } {
  const all = menuAgents(agents, defaultId);
  if (!all.some((a) => FEATURED.includes(a.id))) return { top: all, more: [] };
  const lead = (a: AgentInfo, i: number) => (i === 0 && a.id === defaultId) || FEATURED.includes(a.id);
  return { top: all.filter(lead), more: all.filter((a, i) => !lead(a, i)) };
}

/** SESS-009: installed agents matching `query`, best first: the shown name (its start, then a word's
 *  start, then anywhere), then the alias (id), then the initials, then the command name. `null`
 *  means no search: blank, or too long to bother with. */
export function searchAgents(agents: AgentInfo[], query: string): AgentInfo[] | null {
  const q = query.trim().toLowerCase();
  if (!q || q.length > MAX_SEARCH) return null;
  const score = (a: AgentInfo) => {
    const name = a.name.toLowerCase();
    const words = name.split(/[\s-]+/);
    if (name.startsWith(q)) return 0;
    if (words.some((w) => w.startsWith(q))) return 1;
    if (name.includes(q)) return 2;
    if (a.id.toLowerCase().includes(q)) return 3;
    if (words.map((w) => w[0]).join("").startsWith(q)) return 4;
    return a.program.toLowerCase().includes(q) ? 5 : -1;
  };
  return agents
    .filter((a) => a.installed)
    .map((a, i) => ({ a, i, s: score(a) }))
    .filter((x) => x.s >= 0)
    .sort((x, y) => x.s - y.s || x.i - y.i)
    .map((x) => x.a);
}

/** SESS-009: typing terminal, shell or blank brings up the blank-terminal row. */
export const wantsTerminal = (query: string) => {
  const q = query.trim().toLowerCase();
  return q.length > 0 && ["terminal", "shell", "blank"].some((w) => w.startsWith(q) || q.startsWith(w));
};

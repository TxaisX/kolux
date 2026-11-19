// T-570: the agent buttons' helpers, pure so they can be tested without a browser.
import type { AgentInfo } from "./PlusMenu";

/** Every catalogue agent for the dropdown, A to Z by shown name (T-664, Txais 2026-11-02; replaces the featured three first). Nothing while detection runs. */
export function pickList(agents: AgentInfo[], detecting: boolean): AgentInfo[] {
  if (detecting) return [];
  // T-809 (P4a-11): the installed agents sit above the rest, each group A to Z.
  return [...agents].sort((x, y) => Number(y.installed) - Number(x.installed) || x.name.localeCompare(y.name, undefined, { sensitivity: "base" }));
}

/** The agents with their own button on each seat, in this order (Txais 2026-11-08). Every other agent sits behind Other. */
export const FEATURED = ["claude", "codex", "opencode", "grok"];

/** The featured agents Kolux knows about, in FEATURED order. */
export const featuredRows = (rows: AgentInfo[]): AgentInfo[] => FEATURED.flatMap((id) => rows.filter((a) => a.id === id));

/** What the Other window lists: installed agents without their own button, A to Z (rows arrive sorted). */
export const otherRows = (rows: AgentInfo[]): AgentInfo[] => rows.filter((a) => a.installed && !FEATURED.includes(a.id));

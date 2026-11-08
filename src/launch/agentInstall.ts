// T-570: the agent dropdown's helpers. `installAgent` is the typed wrapper for the Rust command
// `agents_install` (runs the agent's official installer and gives back the refreshed AgentInfo, or
// rejects with one plain sentence). The rest is pure so it can be tested without a browser.
import { invoke } from "@tauri-apps/api/core";
import type { AgentInfo } from "./PlusMenu";

export const installAgent = (id: string): Promise<AgentInfo> => invoke<AgentInfo>("agents_install", { id });

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

export const optionLabel = (a: AgentInfo): string => (a.installed ? a.name : `${a.name} (not installed)`);

/** What Install shows as its tooltip: the command Kolux would run. */
export const installTip = (a: AgentInfo): string => [a.install ?? `Install ${a.name}`, a.installNote].filter(Boolean).join(". ");

/** T-787 (P3-14): the line shown beside Install when a click would raise Windows' admin prompt for Node.js; null when it would not. */
export const installNoteOf = (a: AgentInfo): string | null => (!a.installed && a.installable !== false ? (a.installNote ?? null) : null);

/** Install is offered for a picked agent that is missing and that Kolux knows an official route for. */
export const canInstall = (a: AgentInfo | undefined): boolean => !!a && !a.installed && a.installable !== false;

export type InstallResult = { agent: AgentInfo } | { error: string };

/** Runs the install; the app's own sentence on failure, or a plain one when it ended with the agent still missing. */
export async function runInstall(a: AgentInfo, install: (id: string) => Promise<AgentInfo> = installAgent): Promise<InstallResult> {
  try {
    const now = await install(a.id);
    return now.installed ? { agent: now } : { error: `${a.name} did not finish installing.` };
  } catch (e) {
    const text = typeof e === "string" ? e : e instanceof Error ? e.message : "";
    return { error: text || `${a.name} could not be installed.` };
  }
}

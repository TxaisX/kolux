// T-570: the agent dropdown's helpers. `installAgent` is the typed wrapper for the Rust command
// `agents_install` (runs the agent's official installer and gives back the refreshed AgentInfo, or
// rejects with one plain sentence). The rest is pure so it can be tested without a browser.
import { invoke } from "@tauri-apps/api/core";
import type { AgentInfo } from "./PlusMenu";

export const installAgent = (id: string): Promise<AgentInfo> => invoke<AgentInfo>("agents_install", { id });

/** Every catalogue agent for the dropdown, A to Z by shown name (T-664, Txais 2026-11-02; replaces the featured three first). Nothing while detection runs. */
export function pickList(agents: AgentInfo[], detecting: boolean): AgentInfo[] {
  if (detecting) return [];
  return [...agents].sort((x, y) => x.name.localeCompare(y.name, undefined, { sensitivity: "base" }));
}

export const optionLabel = (a: AgentInfo): string => (a.installed ? a.name : `${a.name} (not installed)`);

/** What Install shows as its tooltip: the command Kolux would run. */
export const installTip = (a: AgentInfo): string => a.install ?? `Install ${a.name}`;

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

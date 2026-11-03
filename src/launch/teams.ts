// Claude Agent Teams in the agent picker. The entry starts the Kolux command line's claude-teams
// command, which runs Claude Code with Agent Teams turned on inside the new Kolux pane. It is
// offered only when the Agent Teams mode preference is on, Claude Code and the Kolux command line
// are both installed, and Kolux runs on neither native Windows nor WSL (the command refuses there).
// The preference is off by default; on Windows and WSL teammates always run in-process.
// Native panes (teammates opening as Kolux panes beside the leader) are T-191-c; until then the
// command keeps teammates in-process whichever mode is picked.
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import type { AgentInfo } from "./PlusMenu";

/** The settings key for the Agent Teams mode preference (carried over from the old app). */
export const TEAMS_MODE_KEY = "agentTeamsMode";
export const TEAMS_MODES = ["off", "in-process", "native"] as const;
export type TeamsMode = (typeof TEAMS_MODES)[number];
/** UX audit F4: Native panes is not built, so it is offered only to a profile that already has it saved. */
export const pickableModes = (current: TeamsMode): readonly TeamsMode[] => TEAMS_MODES.filter((m) => m !== "native" || current === "native");

export const TEAMS_MODE_LABEL: Record<TeamsMode, string> = { off: "Off", "in-process": "In-process", native: "Native panes" };
/** The picker entry's stable agent id (COMPAT agents table); it also names the keybinding command
 *  `tab.newAgent.claude-agent-teams` already listed in the keys. */
export const TEAMS_ID = "claude-agent-teams";
/** The Kolux command line's subcommand the entry runs (`kolux claude-teams`, CLI-013). */
export const TEAMS_COMMAND = "claude-teams";

/** What the Rust side knows about this machine. `cli` is the Kolux command line's bare name
 *  (CLI-007), set only when it is installed on the system search path; a Kolux pane finds it first. */
export type TeamsHost = { windows: boolean; wsl: boolean; cli: string | null };

/** The saved mode; anything unknown or missing is off. */
export function teamsMode(settings: Record<string, unknown> | null | undefined): TeamsMode {
  const v = settings?.[TEAMS_MODE_KEY];
  return TEAMS_MODES.includes(v as TeamsMode) ? (v as TeamsMode) : "off";
}

/** The mode teammates really get: on Windows and WSL native panes fall back to in-process. */
export function effectiveMode(mode: TeamsMode, host: Pick<TeamsHost, "windows" | "wsl">): TeamsMode {
  return mode === "native" && (host.windows || host.wsl) ? "in-process" : mode;
}

/** The picker entry, or null when it is not offered. */
export function teamsEntry(agents: AgentInfo[], mode: TeamsMode, host: TeamsHost | null): AgentInfo | null {
  if (mode === "off" || !host || host.windows || host.wsl || !host.cli) return null;
  if (!agents.some((a) => a.id === "claude" && a.installed)) return null;
  return { id: TEAMS_ID, name: "Claude Agent Teams", program: host.cli, args: [TEAMS_COMMAND], installed: true, path: host.cli };
}

/** `agents` with the Agent Teams entry right after Claude Code, when it is offered. */
export function withTeams(agents: AgentInfo[], settings: Record<string, unknown> | null | undefined, host: TeamsHost | null): AgentInfo[] {
  const entry = teamsEntry(agents, teamsMode(settings), host);
  if (!entry || agents.some((a) => a.id === TEAMS_ID)) return agents;
  const at = agents.findIndex((a) => a.id === "claude");
  return [...agents.slice(0, at + 1), entry, ...agents.slice(at + 1)];
}

/** The host facts, asked once; null until they come (so nothing is offered meanwhile) or if the ask fails. */
export function useTeamsHost(): TeamsHost | null {
  const [host, setHost] = useState<TeamsHost | null>(null);
  useEffect(() => {
    let live = true;
    invoke<TeamsHost>("teams_host").then(
      (h) => live && setHost(h),
      () => live && setHost(null),
    );
    return () => {
      live = false;
    };
  }, []);
  return host;
}

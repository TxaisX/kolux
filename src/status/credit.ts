// T-257 (SESS-040): busy spinners and tab titles credit the agent that was LAUNCHED in a pane, read
// from the pane's own launch record, never an agent guessed from what it prints. The terminal title
// the agent sets still says whether it is busy (STAT-033's titleState), and the title patterns of
// MiMo, Pi-style agents and Cursor are recognised (by the marks the agent itself prints, STAT-033) so
// that a title naming a DIFFERENT agent is not taken as anybody's state: the named agent is claimed only when
// the dot (the title) and the row (the launch record) agree. Pure, so every rule is tested here;
// App.tsx and TerminalPane.tsx call it (evidence/hooks-T-257-*.patch).
import type { AgentState } from "../projects/rows";
import { titleState } from "../terminal/status";
import { creditedAgent } from "../launch/paneMark";
import { agents as AGENT_NAMES } from "../keys/actions";
import type { Identity } from "../terminal/shellMarks";
import { titleOwner } from "./titleOwner";

/** The parts of a pane's record that say what was launched in it. */
export type LaunchRecord = { agent: string; agentId?: string; program?: string | null; kind?: string; seats?: unknown };

/** The catalogue agent launched in a pane: its catalogue id, else its own agent, else the agent its program runs; null for a plain shell, an editor or other non-terminal tab, and a kit's multi-seat tab. */
export function launchedAgent(p: LaunchRecord): string | null {
  if (p.kind || p.seats) return null;
  if (p.agentId) return p.agentId;
  if (p.agent !== "shell") return p.agent;
  return p.program ? creditedAgent(p.program) : null;
}

/** The launched agent's own name ("MiMo Code", "Cursor"), for a tab with no better title; null when nothing was launched. */
export function launchedName(p: LaunchRecord): string | null {
  const id = launchedAgent(p);
  if (!id) return null;
  return AGENT_NAMES.find(([a]) => a === id)?.[1] ?? null;
}

/** The catalogue agents a terminal title names by the marks the agent itself prints (STAT-033, titleOwner.ts); none for a blank title, a bare path, or marks that conflict. */
export function titleNames(title: string): Set<string> {
  return new Set(titleOwner(title).owners);
}

export type TitleCredit = { agent: string; state: AgentState | null; named: boolean };

/** What a title says about the launched agent: its busy state, and whether the title named it. Null with no launch record, when the title's marks name only some other agent, or when they conflict (nothing is claimed). */
export function titleCredit(launched: string | null, title: string): TitleCredit | null {
  if (!launched) return null;
  const owner = titleOwner(title);
  if (owner.unknown) return null;
  const names = new Set(owner.owners);
  if (names.size > 0 && !names.has(launched)) return null;
  return { agent: launched, state: titleState(title), named: names.has(launched) };
}

/** The state a pane takes from a new title while no hook reports. A launched pane takes it only when the title agrees with the launch; a plain shell keeps STAT-033's title reading. */
export function titleGuess(launched: string | null, title: string): AgentState | null {
  if (!launched) return titleState(title);
  return titleCredit(launched, title)?.state ?? null;
}

/** TERM-058's live identity as a launched pane may use it: an agent the title names that is not the launched one is dropped, so the icon stays the launched agent's. */
export function creditedLive(launched: string | null, live: Identity): Identity {
  if (!launched || live.agent === null || live.agent === launched) return live;
  return { ...live, agent: null };
}

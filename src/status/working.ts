// T-259 (STAT-036): how many agents are working in each workspace. Pure, so the counting rules are
// tested on their own; App.tsx hands the result to the sidebar through each row's info.
import { paneState, type AgentState } from "../projects/rows";
import { launchedAgent, titleCredit } from "./credit";

type CountedPane = { key: number; cwd: string | null; agent: string; agentId?: string; program?: string | null; kind?: string; seats?: unknown };
/** What a pane's shell marks say about its running program (TERM-058): the title it set. */
type LiveTitle = { title: string | null };

/** Whether a pane is one agent seat the sidebar counts: a shell, a non-terminal tab and a kit's multi-seat tab are not. */
export function countsAsAgent(p: CountedPane): boolean {
  // SESS-040: an agent launched in a pane counts by its launch record, so Cursor, MiMo or Pi (which
  // carry no vendor mark of their own) count as well as Claude and Codex.
  return p.cwd !== null && !p.seats && launchedAgent(p) !== null;
}

/**
 * Working agents per workspace folder (keyed by the pane's own cwd, as the sidebar's row states are).
 * Split panes are separate panes, so two halves running an agent each count two. When a pane has no
 * hook-fed state, the title the launched agent set says whether it is busy (SESS-040: only a title
 * that names no other agent); with neither, its program being up counts it, the same guess the row's
 * dot makes; an ended program never counts.
 */
export function workingByDir(panes: CountedPane[], hook: Record<number, AgentState>, running: Record<number, boolean>, live: Record<number, LiveTitle> = {}): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of panes) {
    if (!countsAsAgent(p)) continue;
    const launched = launchedAgent(p) as string;
    const title = live[p.key]?.title;
    const fromTitle = running[p.key] !== false && title ? titleCredit(launched, title)?.state ?? null : null;
    const state = hook[p.key] ?? fromTitle ?? paneState(launched, running[p.key]);
    if (state === "working") out[p.cwd as string] = (out[p.cwd as string] ?? 0) + 1;
  }
  return out;
}

/** What the sidebar says beside a workspace: "2 working", or nothing for none. */
export function workingWord(n: number | undefined): string {
  return n !== undefined && n > 0 ? `${n} working` : "";
}

/** A sleeping workspace, or one with no pane open, is inactive: it never shows a working count. */
export function inactive(asleep: boolean, open: number): boolean {
  return asleep || open === 0;
}

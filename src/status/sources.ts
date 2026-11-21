// One pane as the sidebar rows read it (T-608): its one status (status/chip.ts paneStatus), else what its
// program says (an agent works until it ends). `stamp` is when its state last moved.
import { paneState, type AgentState } from "../projects/rows";

export type Source = { key: number; agent: string; title: string; branch: string | null; cwd: string | null; view?: string | null; state: AgentState; interrupted: boolean; running: boolean; changed: number; finishedAt: number | null; chat?: boolean; untitled?: boolean };

export function sourceOf(p: { key: number; agent: string; branch: string | null; cwd: string | null; view?: string | null; chat?: true; title?: string }, title: string, status: AgentState | undefined, running: boolean | undefined, stamp?: { at: number; interrupted: boolean }): Source {
  const state = status ?? paneState(p.agent, running);
  return { key: p.key, agent: p.agent, title, branch: p.branch, cwd: p.cwd, ...(p.view !== undefined ? { view: p.view } : {}), ...(p.chat ? { chat: true, ...(p.title ? {} : { untitled: true }) } : {}), state, interrupted: stamp?.interrupted ?? false, running: running !== false, changed: stamp?.at ?? 0, finishedAt: state === "done" ? (stamp?.at ?? null) : null };
}

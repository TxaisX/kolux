// T-579: the rules behind the "Install coding agents" checklist, kept apart from the screen so they can be
// tested without one. Wire shapes are frozen with the Rust side (agents_install_many and the
// "agent-install-progress" event, both camelCase).
import type { AgentInfo } from "./PlusMenu";
import { canInstall } from "./agentInstall";

/** One entry of agents_install_many's answer. */
export type InstallResult = { id: string; ok: boolean; error?: string | null; agent?: AgentInfo | null };
/** The payload of the "agent-install-progress" event. */
export type ProgressEvent = { id: string; state: "queued" | "installing" | "ok" | "failed"; error?: string | null };
/** What the screen remembers per agent while a batch runs (and the failures after it). */
export type Progress = Record<string, { state: ProgressEvent["state"]; error?: string | null }>;

export const PROGRESS_EVENT = "agent-install-progress";
export const INSTALL_MANY = "agents_install_many";

/** Kolux knows an official install route for this agent and it is not on the PC yet. One rule, shared with the chooser's Install button (agentInstall.ts). */
export { canInstall };

/** Agents with no install route here and nothing installed: the row sends people to the agent's own website. */
export const websiteOnly = (a: AgentInfo): boolean => a.installable === false && !a.installed;

const busyState = (p: Progress[string] | undefined) => p?.state === "queued" || p?.state === "installing";

/** Every installable agent that is not installed starts ticked. */
export const startTicks = (agents: readonly AgentInfo[]): string[] => agents.filter(canInstall).map((a) => a.id);

/** Select all: every installable, not-installed agent. */
export const selectAll = startTicks;

/** The ids the Install button would send: ticked, installable, not installed, and not already running or done. */
export function selectedIds(agents: readonly AgentInfo[], ticks: readonly string[], progress: Progress = {}): string[] {
  return agents.filter((a) => canInstall(a) && ticks.includes(a.id) && (progress[a.id] === undefined || progress[a.id].state === "failed")).map((a) => a.id);
}

/** The N in "Install selected (N)". */
export const selectedCount = (agents: readonly AgentInfo[], ticks: readonly string[], progress: Progress = {}): number => selectedIds(agents, ticks, progress).length;

export const installLabel = (n: number): string => `Install selected (${n})`;

/** True while any agent of the batch is waiting or installing. */
export const running = (progress: Progress): boolean => Object.values(progress).some(busyState);

/** One progress event folded into the screen's state. */
export const applyEvent = (progress: Progress, e: ProgressEvent): Progress => ({ ...progress, [e.id]: { state: e.state, error: e.error ?? null } });

/** The state every id of a new batch starts in. Entries of earlier batches are dropped. */
export const queueAll = (ids: readonly string[]): Progress => Object.fromEntries(ids.map((id) => [id, { state: "queued" as const, error: null }]));

/**
 * The refreshed list once a batch ends: each result's agent replaces the old row. A success without an
 * agent still marks the row installed. Failures keep the row and are reported by `afterBatch`.
 */
export function mergeResults(agents: readonly AgentInfo[], results: readonly InstallResult[]): AgentInfo[] {
  return agents.map((a) => {
    const r = results.find((x) => x.id === a.id);
    if (!r) return a;
    if (r.agent) return r.agent;
    return r.ok ? { ...a, installed: true } : a;
  });
}

/** The progress left on screen after the batch: failures with their text as-is, successes as installed. */
export function afterBatch(progress: Progress, results: readonly InstallResult[]): Progress {
  const next = { ...progress };
  for (const r of results) next[r.id] = r.ok ? { state: "ok", error: null } : { state: "failed", error: r.error ?? null };
  return next;
}

/** The words after a row's name, or null when the row says nothing (a plain not-installed agent). */
export function rowWords(a: AgentInfo, progress: Progress): string | null {
  const p = progress[a.id];
  if (p) {
    if (p.state === "queued") return "Waiting";
    if (p.state === "installing") return "Installing…";
    if (p.state === "ok") return "Installed";
    return p.error ? `Failed: ${p.error}` : "Failed";
  }
  return a.installed ? "Installed" : null;
}

/** Whether a row's box is ticked: installed rows always are. */
export const isTicked = (a: AgentInfo, ticks: readonly string[], progress: Progress): boolean => a.installed || progress[a.id]?.state === "ok" || ticks.includes(a.id);

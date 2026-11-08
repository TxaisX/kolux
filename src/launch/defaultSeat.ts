// T-571 (Txais 2026-10-28): one default model and effort every new seat starts from, whatever the agent. It reverses
// "Kolux never picks an AI or a model for you". A seat can still change both. Model ids belong to an agent, so an agent
// that does not list the default model starts on its program's own default; an effort applies only where the model has it.
import { savedSeat } from "../chat/controls";
import { DEFAULT_MODEL, modelsFor, TERMINAL, type Seat } from "./seats";

export const DEFAULT_MODEL_KEY = "defaultModel";
export const DEFAULT_EFFORT_KEY = "defaultEffort";

/** What a profile that never chose gets. An empty string saved means "no default: pick per seat". */
export const SHIPPED_DEFAULT = { model: "opus", effort: "medium" }; // Opus at medium (Txais 2026-11-08)

export type SeatDefault = { model: string; effort: string };

export function seatDefault(settings: Record<string, unknown> | null | undefined): SeatDefault {
  const read = (key: string, shipped: string) => (typeof settings?.[key] === "string" ? (settings[key] as string) : shipped);
  return { model: read(DEFAULT_MODEL_KEY, SHIPPED_DEFAULT.model), effort: read(DEFAULT_EFFORT_KEY, SHIPPED_DEFAULT.effort) };
}

/** The fields a seat starts with when `agent` is picked. */
export function seatStart(agent: string, d: SeatDefault, saved: ReturnType<typeof savedSeat> = agent === TERMINAL ? { model: null } : savedSeat(agent)): Pick<Seat, "agent" | "model" | "effort" | "fast"> {
  if (agent === TERMINAL) return { agent, model: null, effort: undefined, fast: undefined };
  const models = modelsFor(agent);
  if (d.model !== "" && models.length > 0) {
    const model = models.some((m) => m.id === d.model) ? d.model : DEFAULT_MODEL;
    const effort = models.find((m) => m.id === model)?.efforts?.includes(d.effort) ? d.effort : undefined;
    return { agent, model, effort, fast: undefined };
  }
  // No default chosen: a program with one model starts on it, else the model saved for the agent, else the person picks.
  return { agent, model: models.length === 1 ? DEFAULT_MODEL : null, effort: undefined, fast: undefined, ...(saved.model ? saved : {}) };
}

/** T-809 (P4a-11): the seats with the default agent put on seat 1, or null when nothing should change: no default saved, it is not installed, or a seat already has a pick. */
export function firstSeatStart(seats: Seat[], defaultId: string, agents: { id: string; installed: boolean }[], d: SeatDefault): Seat[] | null {
  if (defaultId === "" || !agents.some((a) => a.id === defaultId && a.installed)) return null;
  if (seats.length === 0 || seats.some((s) => s.agent !== null)) return null;
  return seats.map((s, i) => (i === 0 ? { ...s, ...seatStart(defaultId, d) } : s));
}

/** The Settings choices: every model any built-in agent lists (once per id), and the effort levels they use. */
export function defaultChoices(): { models: { id: string; label: string }[]; efforts: string[] } {
  const models = new Map<string, string>();
  const efforts = new Set<string>();
  for (const agent of ["claude", "codex", "gemini", "cursor", "grok"]) {
    for (const m of modelsFor(agent)) {
      if (m.id === DEFAULT_MODEL) continue;
      if (!models.has(m.id)) models.set(m.id, m.label);
      m.efforts?.forEach((e) => efforts.add(e));
    }
  }
  const order = ["low", "medium", "high", "xhigh", "max"];
  return { models: [...models].map(([id, label]) => ({ id, label })), efforts: order.filter((e) => efforts.has(e)) };
}

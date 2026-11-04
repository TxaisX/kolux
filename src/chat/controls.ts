// Native chat, model and effort controls beside Send (CHAT-024; T-334). Pure rules: the choices an agent
// lists, which change can be made from the chat and which only at launch, the model read back from the
// agent, the sent/confirmed state of each change, the choices saved per agent for the next launch, and
// the bare /model that opens the picker. The controls themselves are in ModelControls.tsx.
import { DEFAULT_MODEL, modelsFor, seatArgs, type ModelChoice } from "../launch/seats";
import type { ChatItem } from "./model";

/** The effort levels from minimal to max, in order. */
export const EFFORT_ORDER = ["minimal", "low", "medium", "high", "xhigh", "max"];
// Codex's reasoning levels, from its public documentation.
const CODEX_EFFORTS = ["minimal", "low", "medium", "high"];

export type Choice = { model?: string; effort?: string; fast?: boolean };
export type What = "model" | "effort" | "fast";

/** The agents that have these controls. */
export const hasControls = (agent: string | undefined) => agent === "claude" || agent === "openclaude" || agent === "codex";
const base = (agent: string) => (agent === "openclaude" ? "claude" : agent);

/** The models to pick from, the agent's own default named last. */
export const choicesFor = (agent: string): ModelChoice[] => modelsFor(base(agent)).map((m) => (m.id === DEFAULT_MODEL ? { ...m, label: "Agent default" } : m));

/** The effort levels of `model`, minimal to max; Codex's models all list the same four. */
export function effortsFor(agent: string, model: string | undefined): string[] {
  if (base(agent) === "codex") return CODEX_EFFORTS;
  const m = choicesFor(agent).find((c) => c.id === model);
  return (m?.efforts ?? []).slice().sort((a, b) => EFFORT_ORDER.indexOf(a) - EFFORT_ORDER.indexOf(b));
}

export const fastOffered = (agent: string, model: string | undefined) => !!choicesFor(agent).find((c) => c.id === model)?.fast;

/** How a change is made: Claude takes `/model` in the box; Codex's changes go through its own picker in the terminal;
 * the rest can only be set when a session starts. */
export type Route = "chat" | "terminal" | "launch";
export function routeOf(agent: string, what: What): Route {
  if (base(agent) === "claude") return what === "model" ? "chat" : "launch";
  return what === "fast" ? "launch" : "terminal";
}
export const LAUNCH_NOTE = "Set when a session starts. Saved for the next launch.";
export const TERMINAL_NOTE = "Pick it in the agent's own picker in the terminal.";
export const MODEL_NOT_SENT = "The model change was not sent.";

/** The command that switches a Claude model from the box. */
export const modelCommand = (model: string) => `/model ${model}`;

/** CHAT-024: a bare /model opens the model picker instead of going to the agent as text. */
export const opensPicker = (agent: string | undefined, text: string) => hasControls(agent) && text.trim() === "/model";

/** CHAT-024: the known model named by the words after /model, or null (the shown model then stays as it was). */
export function modelFromWords(agent: string, words: string): string | null {
  const w = words.trim().toLowerCase();
  if (!w) return null;
  const list = choicesFor(agent).filter((c) => c.id !== DEFAULT_MODEL);
  const hit = list.find((c) => c.id.toLowerCase() === w) ?? list.find((c) => c.label.toLowerCase() === w) ?? list.find((c) => w.split(/\s+/).includes(c.id.toLowerCase()));
  return hit?.id ?? null;
}

/** CHAT-024: the model the agent reports in its recent output ("Set model to Opus …"), as one of the agent's model ids; null when unknown. */
export function readModel(agent: string, items: readonly ChatItem[]): string | null {
  const ids = choicesFor(agent).filter((c) => c.id !== DEFAULT_MODEL);
  for (let i = items.length - 1; i >= Math.max(0, items.length - 60); i--) {
    const it = items[i];
    if (it.role === "user" && it.kind === "text") continue;
    const m = /(?:set|switched|changed) model (?:to|=)\s+([^\n(]+)/i.exec(it.text);
    if (!m) continue;
    const said = m[1].toLowerCase();
    const hit = ids.find((c) => said.includes(c.id.toLowerCase()) || said.includes(c.label.toLowerCase()));
    if (hit) return hit.id;
  }
  return null;
}

/** One change made from the controls: confirmed once the agent shows it, sent until then. */
export type Change = { seq: number; what: What; value: string; status: "sent" | "confirmed" | "failed"; error?: string };

export function sentChange(changes: readonly Change[], what: What, value: string): Change[] {
  const seq = changes.reduce((n, c) => Math.max(n, c.seq), 0) + 1;
  // A newer change of the same kind replaces the older one.
  return [...changes.filter((c) => c.what !== what), { seq, what, value, status: "sent" }];
}

/** The agent now shows `model`: a sent model change for that value is confirmed. A sent pick of the
 * agent's own default is confirmed by whichever model the agent reports next. */
export const confirmModel = (changes: readonly Change[], model: string | null): Change[] =>
  changes.map((c) => (c.what === "model" && c.status === "sent" && (c.value === model || (c.value === DEFAULT_MODEL && model !== null)) ? { ...c, status: "confirmed" as const } : c));

/** A failure for change `seq`: ignored when a newer change of that kind has replaced it. */
export const failChange = (changes: readonly Change[], seq: number, error: string): Change[] =>
  changes.map((c) => (c.seq === seq ? { ...c, status: "failed" as const, error } : c));

/** A pick that did not reach the agent: it stays in the control marked failed, so the pick is not silently
 * reverted and the note under the control says what happened. */
export function failedChange(changes: readonly Change[], what: What, value: string, error: string): Change[] {
  const next = sentChange(changes, what, value);
  return failChange(next, next[next.length - 1].seq, error);
}

export const statusOf = (changes: readonly Change[], what: What) => changes.find((c) => c.what === what);

/** The label under a control: confirmed, or sent but not yet confirmed. */
export function statusText(c: Change | undefined): string | null {
  if (!c) return null;
  return c.status === "confirmed" ? "Confirmed" : c.status === "failed" ? (c.error ?? "Not changed") : "Sent, not confirmed yet";
}

/** The controls are disabled while the agent works or has no live terminal. */
export const controlsOff = (working: boolean, live: boolean) => working || !live;

// --- Choices saved per agent for the next launch (empty by default) ---

export type Saved = Record<string, Choice>;
const KEY = "kolux.chat.launchChoices";

/** The saved set cleaned against what the provider offers now: a model that is gone is forgotten, an effort the model does not list too. */
export function clean(saved: Saved): Saved {
  const out: Saved = {};
  for (const [agent, c] of Object.entries(saved)) {
    const list = choicesFor(agent);
    if (list.length === 0) continue;
    const next: Choice = {};
    if (c.model && c.model !== DEFAULT_MODEL && list.some((m) => m.id === c.model)) next.model = c.model;
    if (c.effort && effortsFor(agent, next.model ?? c.model).includes(c.effort) && (next.model || base(agent) === "codex")) next.effort = c.effort;
    if (c.fast && next.model && fastOffered(agent, next.model)) next.fast = true;
    if (Object.keys(next).length > 0) out[agent] = next;
  }
  return out;
}

export function loadSaved(storage: Pick<Storage, "getItem"> | undefined = safeStorage()): Saved {
  try {
    const raw = storage?.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? clean(parsed as Saved) : {};
  } catch {
    return {};
  }
}

export function saveChoice(agent: string, patch: Partial<Choice>, storage: Pick<Storage, "getItem" | "setItem"> | undefined = safeStorage()): Saved {
  const all = loadSaved(storage);
  const now: Choice = { ...all[agent], ...patch };
  // A different model starts with its own effort and fast mode.
  if (patch.model !== undefined && patch.model !== all[agent]?.model) {
    if (patch.effort === undefined) delete now.effort;
    if (patch.fast === undefined) delete now.fast;
  }
  const next = clean({ ...all, [agent]: now });
  try {
    storage?.setItem(KEY, JSON.stringify(next));
  } catch {
    // the choice still applies for this session
  }
  return next;
}

/** The launch arguments of the choice saved for `agent` (none when nothing is saved or the model was withdrawn). */
export function savedArgs(agent: string, saved: Saved = loadSaved()): string[] {
  const c = saved[agent];
  if (!c) return [];
  return seatArgs({ agent: base(agent), model: c.model ?? null, effort: c.effort, fast: c.fast });
}

/** Row 389: the seat fields the launch pane starts from when `agent` is picked: its saved model, effort
 * and fast mode (cleaned by loadSaved), or no model so the pick stays explicit when nothing is saved. */
export function savedSeat(agent: string, saved: Saved = loadSaved()): { model: string | null; effort?: string; fast?: boolean } {
  const c = saved[agent];
  return { model: c?.model ?? null, effort: c?.effort, fast: c?.fast };
}

function safeStorage(): Storage | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

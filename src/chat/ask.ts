// Native chat, the permission card (CHAT-023; T-329). When the agent asks to run a tool, the chat
// shows a card with Allow and Deny (and Review plan when the request is to leave plan mode). The
// answer is typed into the agent's terminal only while the prompt the user saw is still the one
// showing; the rules for that come from the terminal pane's own buttons (permissionAnswer.ts,
// imported, not copied): prompts are counted, the hook has to name the tool, and an answered
// prompt stays answered until the next one.
import { answerKeys, buttonsShown, canAnswer, nextPrompt, type Answer } from "../terminal/permissionAnswer";
import type { AgentState } from "../projects/rows";
import { showsReview } from "../terminal/planReview";
import { answered, hearingNow } from "./send";
import { enqueue } from "./composer";

/** What the window knows about a pane's latest permission prompt. */
export type Ask = {
  /** Prompts counted so far: each transition into "permission" is a new one. */
  count: number;
  /** The prompt count the user answered or dismissed; a card shows only while this is behind count. */
  answered: number;
  /** FIX-1: the highest prompt count answered in the terminal itself (a key or its own buttons): a click on a card
   * for that prompt, even one already waiting in the terminal's queue, types nothing. */
  elsewhere?: number;
  state?: string;
  tool?: string;
  detail?: string;
  plan?: string;
  planCut?: boolean;
  /** The terminal the newest event came from (an event from an earlier run says nothing now). */
  terminal?: number;
};

type H = Parameters<typeof nextPrompt>[1];
type Payload = { paneKey: number; state?: string; tool?: string; detail?: string; plan?: string; planCut?: boolean; terminal?: number };
type Listen = (name: string, h: (e: { payload: Payload }) => void) => Promise<unknown>;

const BLANK: Ask = { count: 0, answered: 0 };

/** One hook event folded into the pane's prompt record. */
export function takeAsk(prev: Ask | undefined, e: Payload): Ask {
  const was = prev ?? BLANK;
  if (e.state === undefined) return was;
  let count = nextPrompt(was.count, was.state as H, e.state as H);
  if (e.state !== "permission") return { count, answered: was.answered, elsewhere: was.elsewhere, state: e.state, terminal: e.terminal ?? was.terminal };
  // FIX-1: a permission event that names another tool or detail than the prompt showing is a new prompt (the card and any
  // click on it were for the old one); naming what an unnamed prompt left out is the same prompt.
  const changed = was.state === "permission" && ((e.tool !== undefined && was.tool !== undefined && e.tool !== was.tool) || (e.detail !== undefined && was.detail !== undefined && e.detail !== was.detail));
  if (changed) count += 1;
  // The same prompt reported again keeps what it already told; a new one starts clean.
  const fresh = was.state !== "permission" || changed;
  return {
    count,
    answered: was.answered,
    elsewhere: was.elsewhere,
    state: "permission",
    tool: e.tool ?? (fresh ? undefined : was.tool),
    detail: e.detail ?? (fresh ? undefined : was.detail),
    plan: e.plan ?? (fresh ? undefined : was.plan),
    planCut: e.planCut ?? (fresh ? undefined : was.planCut),
    terminal: e.terminal ?? was.terminal,
  };
}

const asks = new Map<number, Ask>();
const subs = new Set<() => void>();
let hearing: Promise<unknown> | null = null;
const poke = () => subs.forEach((f) => f());

/** The pane's latest prompt record, if any event named one. */
export const askOf = (key: number) => asks.get(key);
/** Calls f whenever any pane's record changes; returns the way to stop. */
export function subscribeAsk(f: () => void): () => void {
  subs.add(f);
  return () => void subs.delete(f);
}
/** One listener for the window: every pane's prompts are counted even while its chat is not on screen. */
export function hearAsks(listen: Listen): Promise<unknown> {
  if (!hearing)
    hearing = listen("agent-status", (e) => {
      const next = takeAsk(asks.get(e.payload.paneKey), e.payload);
      if (next === asks.get(e.payload.paneKey)) return;
      asks.set(e.payload.paneKey, next);
      poke();
    });
  return hearing;
}
/** For tests: drops every record and the listener. */
export function forgetAsks() {
  asks.clear();
  subs.clear();
  hearing = null;
}

/** The agents whose prompts the card knows the keys for. Any other agent is left out: it has no hook route here, and its menu's
 * keys are not confirmed (the card would type guessed keys into it). */
export const CARD_AGENTS = ["claude", "codex"] as const;

export type Card = { tool: string; detail?: string; plan?: string; planCut?: boolean; /** The prompt count this card was drawn for. */ drawnAt: number; review: boolean };

/** CHAT-023: the card to draw for a pane, or null: only for an agent whose keys are known, while its hook still says
 * "permission" for a named tool, the prompt is not the answered one, and the event came from the pane's current terminal.
 * FIX-2: `window` is the window's own reading of the pane (when it gives readings at all); an answer given on a surface this
 * file never hears of (the board, the plan sheet) moves that reading on, and then there is no card. */
export function cardOf(agent: string | undefined, ask: Ask | undefined, terminal?: number, window?: () => string | undefined): Card | null {
  if (!ask || !agent || !(CARD_AGENTS as readonly string[]).includes(agent)) return null;
  if (ask.terminal !== undefined && terminal !== undefined && ask.terminal !== terminal) return null;
  if (window && window() !== "permission") return null;
  if (!buttonsShown(agent, ask.state as H, ask.answered, ask.count, ask.tool)) return null;
  return { tool: ask.tool as string, detail: ask.detail, plan: ask.plan, planCut: ask.planCut, drawnAt: ask.count, review: showsReview(ask.state as AgentState, { tool: ask.tool, plan: ask.plan }) };
}

/** The user closed the card without answering (they will answer in the terminal): it stays closed until the next prompt. */
export function dismissAsk(key: number, drawnAt: number) {
  const a = asks.get(key);
  if (!a || a.answered >= drawnAt) return;
  asks.set(key, { ...a, answered: drawnAt });
  poke();
}

/** FIX-1: the user answered the pane's open prompt in the terminal itself (a key into the program, or the terminal pane's own
 * Approve / Deny). The terminal pane calls this at both of its answer points. The card goes, and a click on it that is
 * already on its way types nothing. Harmless when the pane has no prompt record. */
export function answeredElsewhere(key: number) {
  const a = asks.get(key);
  if (!a || (a.answered >= a.count && (a.elsewhere ?? 0) >= a.count)) return;
  asks.set(key, { ...a, answered: Math.max(a.answered, a.count), elsewhere: a.count });
  poke();
}

export type AnswerDeps = {
  terminalOf: (key: number) => number | undefined;
  /** FIX-2: the window's hook reading for a pane, read live. When given, a click types only while it still says "permission". */
  stateOf?: (key: number) => string | undefined;
  write: (terminal: number, data: string) => Promise<unknown>;
};
/** What came of a click: the keys went in, the prompt had already gone (nothing typed), or the pane has no terminal. */
export type AnswerOutcome = "sent" | "gone" | "no-terminal";

/** CHAT-023: Allow or Deny. The prompt is marked answered first (the card goes, even if nothing could be typed); the
 * keys are typed only while canAnswer still holds for the prompt this card was drawn for. Allow is Enter on Claude
 * (Yes is highlighted) and y on Codex; Deny is Escape on Claude and n on Codex, which tells the agent no. */
export async function answerCard(key: number, agent: string, answer: Answer, drawnAt: number, deps: AnswerDeps): Promise<AnswerOutcome> {
  const ask = asks.get(key);
  const terminal = deps.terminalOf(key);
  const already = !!ask && ask.answered >= drawnAt;
  dismissAsk(key, drawnAt);
  if (terminal === undefined) return "no-terminal";
  const keys = answerKeys(agent, answer);
  const stale = ask?.terminal !== undefined && ask.terminal !== terminal;
  if (!ask || already || keys === null || stale || !canAnswer(agent, ask.state as H, drawnAt, ask.count, ask.tool)) return "gone";
  if (deps.stateOf && deps.stateOf(key) !== "permission") return "gone"; // FIX-2: answered on a surface this file did not hear
  const since = hearingNow();
  // FIX-1: the queue may hold earlier writes; the prompt is checked again when this one's turn comes.
  const typed = await enqueue(terminal, async () => {
    const now = asks.get(key);
    if (!now || (now.elsewhere ?? 0) >= drawnAt || deps.terminalOf(key) !== terminal) return false;
    if (now.terminal !== undefined && now.terminal !== terminal) return false;
    if (deps.stateOf && deps.stateOf(key) !== "permission") return false;
    if (!canAnswer(agent, now.state as H, drawnAt, now.count, now.tool)) return false;
    await deps.write(terminal, keys);
    return true;
  });
  if (!typed) return "gone";
  // The chat's own reading moves on at once (the next hook event says the real thing); the window's does at that event.
  answered(key, answer === "approve" ? "working" : "interrupted", since);
  return "sent";
}

/** What the card says it is asking, e.g. "Allow Bash?". */
export const askTitle = (tool: string) => "Allow " + tool + "?";

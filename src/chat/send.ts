// Native chat, the send path (CHAT-020, CHAT-022; T-327, council FIX-1 on a969502, FIX-2 on 8151d6f).
// A message is typed into the agent's terminal only while Kolux can see that the agent is not asking
// anything there: a menu's default answer is Yes, so a send's Enter landing in one would approve it.
// Every reading is looked up by the send's own pane, at every write, never by the pane the screen
// shows now. The window's own pastes (Send notes, a kit's role prompt) use the same check.
import { invoke } from "@tauri-apps/api/core";
import type { AgentState } from "../projects/rows";
import { LIMIT } from "../terminal/paste";
import { ASKING_NOTE, asksInTerminal, cancelQueued, enqueue, epochOf, pasteSteps, sendSteps, typeSteps, type Step } from "./composer";
import { hearAsks } from "./ask";

/** CHAT-022: what the box says when Kolux has no hook reading for the pane (hooks off for it, Codex
 * trust not given, an agent with no hook route, no event yet, or only an event from an earlier run). */
export const UNSEEN_NOTE = "Kolux can't see this agent's questions. Type in its terminal.";
/** CHAT-020: what the box says when a message is longer than one paste may be. */
export const TOO_LONG_NOTE = "This message is too long to send from chat. Shorten it or paste it in the terminal.";
/** What the box says when the pane has no running program to type into. */
export const NO_TERMINAL_NOTE = "This agent's terminal is not running, so nothing was sent.";
/** Council FIX-2: what the box says while the Enter waits out a tool that just started. */
export const TOOL_WAIT_NOTE = "Waiting a moment: the agent is starting a tool.";
/** What the box says when a send began but its Enter was not pressed (the reason follows). */
export const STOPPED_NOTE = "The send stopped before its Enter.";
/** What the box says when the terminal refused a write. */
export const FAILED_NOTE = "The message could not be typed into the terminal.";
const BUSY_NOTE = "The agent kept starting tools. Send it again in a moment.";

/** Council FIX-2 (FS1): after a tool starts with nothing heard after it, the agent may be about to show
 * its permission menu before that event reaches the window; no key goes in until this long after. */
export const TOOL_HOLD_MS = 1000;
/** The longest a send waits on tools that keep starting, before it gives up. */
const TOOL_WAIT_LIMIT = 20;

/** The hook states in which the agent is known not to show a menu. Anything else (no reading, a
 * menu, a word this build does not know) holds the send. */
const CLEAR: readonly AgentState[] = ["working", "queued", "done", "idle", "interrupted", "blocked"];
const clear = (s: string | undefined) => s !== undefined && (CLEAR as readonly string[]).includes(s);

/** CHAT-022: why a send to a pane is held, or undefined when it may go. `app`: the window's own hook
 * reading for the pane (it alone knows hooks were turned off); `ear`: the newest hook event the chat
 * heard for it. Either one asking holds the send; with no window reading the event decides. */
export function holdNote(app: string | undefined, ear: string | undefined, hasApp = app !== undefined): string | undefined {
  if (asksInTerminal(app) || asksInTerminal(ear)) return ASKING_NOTE;
  return clear(hasApp ? app : ear) ? undefined : UNSEEN_NOTE;
}

/** One pane's newest hook event: its state, the terminal it came from, and when it was heard. */
type Heard = { state: string; terminal?: number; at: number };
type Payload = { paneKey: number; state?: string; tool?: string; terminal?: number };
type Listen = (name: string, h: (e: { payload: Payload }) => void) => Promise<unknown>;
const heard = new Map<number, Heard>();
/** Council FIX-3 (FS1 of e5412ff): when a tool last started in each pane (any working event that
 * names one, the lead's or a sub-agent's). A later event with no tool (another agent's tool ending)
 * never clears it: only a menu, a question or the end of the turn does. */
const toolAt = new Map<number, { at: number; terminal?: number }>();
const ENDS_TOOL_HOLD = ["permission", "waiting", "done"];
let hearing: Promise<unknown> | null = null;
/** Stand-in review of 1e9613e, FIX-SOON 2: whether hooks are on in Settings, and whether they have
 * been off since the readings started (then a pane counts as seen only once it is heard again). */
let hooksOn = true;
let needEar = false;
/** Hooks turned off drop every reading the chat holds and stop it taking new ones; while off, and
 * after they are back on until a pane is heard again, no reading of that pane counts as clear (the
 * window's own reading may be one from before they went off). */
export function setHooksOn(on: boolean) {
  if (!on) {
    heard.clear();
    toolAt.clear();
    needEar = true;
  }
  hooksOn = on;
}
let clock: () => number = () => Date.now();
/** For tests: the clock the tool hold is measured with. */
export const setClock = (f: () => number) => void (clock = f);
/** One listener for the whole window: it keeps every pane's newest hook state, so a send to a pane
 * that left the screen still hears that pane's menu open. Safe to call on every mount. */
export function hearStates(listen: Listen): Promise<unknown> {
  // Row 1032: the window calls this at start, so prompts are counted before the Agents screen first opens.
  void hearAsks(listen).catch(() => {});
  if (!hearing)
    hearing = listen("agent-status", (e) => {
      const { paneKey, state, tool, terminal } = e.payload;
      if (state === undefined || !hooksOn) return;
      heard.set(paneKey, { state, terminal, at: clock() });
      if (state === "working" && tool) toolAt.set(paneKey, { at: clock(), terminal });
      else if (ENDS_TOOL_HOLD.includes(state)) toolAt.delete(paneKey);
    });
  return hearing;
}
export const heardOf = (key: number) => heard.get(key)?.state;
/** The time a card answer starts at, on the clock the readings are stamped with (see answered). */
export const hearingNow = () => clock();
/** Council FIX-2 (FS3), FIX-3 (FS2 of e5412ff): an Approve or Deny on a card, started at `since`,
 * answered the pane's menu, and `state` is what Kolux's status says the pane is after it (still
 * "permission" while a second sub-agent asks). The chat's reading takes it only when nothing was
 * heard after the answer started. True when the window's own reading may take it as well. */
export function answered(key: number, state: string, since: number): boolean {
  const h = heard.get(key);
  if (h && h.at > since) return false;
  if (h) heard.set(key, { state, terminal: h.terminal, at: clock() });
  return true;
}
/** For tests: drops every reading, the listener and the test clock. */
export function forgetHearing() {
  heard.clear();
  toolAt.clear();
  hearing = null;
  hooksOn = true;
  needEar = false;
  clock = () => Date.now();
}

/** The chat's reading for pane `key`, unless it came from another terminal than `terminal` (the
 * program was started again and nothing has been heard from the new one yet). */
const earFor = (key: number, terminal: number | undefined) => {
  const h = heard.get(key);
  const stale = h?.terminal !== undefined && terminal !== undefined && h.terminal !== terminal;
  return { h: stale ? undefined : h, stale };
};

/** CHAT-022: why a send to pane `key` (typing into `terminal`) would be held, from the window's
 * reading `app` (`hasApp`: the window gives readings at all). Council FIX-2 (FS4): an event heard
 * from the pane's earlier terminal says nothing about the program running now, and with it the
 * window's reading from that run does not count either. */
export function holdReading(key: number, app: string | undefined, hasApp: boolean, terminal?: number): string | undefined {
  if (!hooksOn || (needEar && !heard.has(key))) return UNSEEN_NOTE;
  const { h, stale } = earFor(key, terminal);
  const note = holdNote(app, h?.state, hasApp);
  return note === undefined && stale ? UNSEEN_NOTE : note;
}
/** Why a send to pane `key` would be held right now, or undefined. When the window gives its
 * readings, its "no reading" holds the send even if an older event said the agent was working (the
 * window drops a pane's reading when the pane's program stops, which a restart does first). The
 * window keeps its reading when hooks are turned off; setHooksOn covers that case. */
export const holdFor = (key: number, stateOf?: (key: number) => string | undefined, terminal?: number) => holdReading(key, stateOf?.(key), stateOf !== undefined, terminal);

/** Council FIX-2 (FS1): how long a key into pane `key` must still wait for a tool that just started. */
export function toolWait(key: number, terminal?: number): number {
  const t = toolAt.get(key);
  if (!t || (t.terminal !== undefined && terminal !== undefined && t.terminal !== terminal)) return 0;
  return Math.max(0, t.at + TOOL_HOLD_MS - clock());
}

/** AFTER 1: the paste limit counts the bytes that go to the terminal, not UTF-16 units. */
export const tooLong = (text: string) => text.length > LIMIT || new TextEncoder().encode(text).length > LIMIT;

export type SendDeps = {
  /** The pane's program session now (asked at send time, so a reconnect's new session is used). */
  terminalOf: (key: number) => number | undefined;
  /** The window's hook reading for a pane, read live (not the value of the last render). */
  stateOf?: (key: number) => string | undefined;
  write: (terminal: number, data: string) => Promise<unknown>;
  sleep?: (ms: number) => Promise<unknown>;
  /** Told when the send waits on a tool that just started (the box shows it). */
  onWait?: (note: string) => void;
};
export type SendOutcome = "sent" | "held" | "stopped" | "too-long" | "no-terminal" | "cancelled";

/** Types `steps` into pane `key`'s terminal, after any earlier send to it. Before every write (the
 * Enter above all) the pane's own readings are checked again, after waiting out a tool that just
 * started; once one is not clear the rest is dropped and "stopped" comes back. */
async function typeInto(key: number, text: string, steps: Step[], deps: SendDeps): Promise<SendOutcome> {
  if (tooLong(text)) return "too-long";
  const terminal = deps.terminalOf(key);
  if (terminal === undefined) return "no-terminal";
  let busy = false;
  // CHAT-018: Stop cancels what is still waiting or half typed (never an Enter already pressed).
  const epoch = epochOf(terminal);
  const cancelled = () => epochOf(terminal) !== epoch;
  const held = () => busy || cancelled() || holdFor(key, deps.stateOf, terminal) !== undefined;
  if (held()) return cancelled() ? "cancelled" : "held";
  const sleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const pause = async () => {
    for (let i = 0, ms = toolWait(key, terminal); ms > 0; i++, ms = toolWait(key, terminal)) {
      if (cancelled()) return; // FIX-1: Stop ends the wait; the held() check right after drops the send
      if (i === TOOL_WAIT_LIMIT) return void (busy = true);
      deps.onWait?.(TOOL_WAIT_NOTE);
      await sleep(ms);
    }
  };
  const done = await enqueue(terminal, () => typeSteps(steps, (d) => deps.write(terminal, d), sleep, held, pause));
  return done ? "sent" : cancelled() ? "cancelled" : "stopped";
}

/** CHAT-020, CHAT-022: types the chat message `text` into pane `key`'s terminal (see typeInto). */
export const sendToPane = (key: number, agent: string | undefined, text: string, deps: SendDeps) => typeInto(key, text, sendSteps(agent, text), deps);

/** Council FIX-2 (FS2): the window's own paste into pane `key` (Send notes, a kit's role prompt):
 * one bracketed paste and its Enter, under the same check as a chat send. */
export const pasteToPane = (key: number, text: string, deps: SendDeps, clearLine = false) => typeInto(key, text, pasteSteps(text, clearLine), deps);

/** The terminal write the window's sends use. */
export const writeTerminal = (id: number, data: string) => invoke("terminal_write", { id, data });

/** CHAT-018: what the box says about a message that was waiting to send when Stop was pressed. */
export const CANCELLED_NOTE = "Stop cancelled the message that was waiting to send.";

/** What to tell the user about a send that did not go: why it was held or stopped. */
export function outcomeNote(got: SendOutcome, key: number, deps: Pick<SendDeps, "terminalOf" | "stateOf">): string {
  if (got === "cancelled") return CANCELLED_NOTE;
  if (got === "too-long") return TOO_LONG_NOTE;
  if (got === "no-terminal") return NO_TERMINAL_NOTE;
  const why = holdFor(key, deps.stateOf, deps.terminalOf(key)) ?? (got === "stopped" ? BUSY_NOTE : UNSEEN_NOTE);
  return got === "stopped" ? `${STOPPED_NOTE} ${why}` : why;
}

export type BoxUi = { note: (n: string | null) => void; onQueued: () => void; onFailed: () => void; /** CHAT-018: the send was cancelled by Stop before its Enter; its waiting row goes. */ onCancelled?: () => void };
/** CHAT-020, CHAT-022: what the chat box's Enter does (ChatView.send runs exactly this). False when
 * nothing was sent, so the box keeps the text, after `note` said why (council FIX-2, FS3). Otherwise
 * the send starts: `onQueued` now, `onFailed` if it ends unsent, with the reason in `note`. */
export function boxSend(key: number, agent: string | undefined, text: string, deps: SendDeps, ui: BoxUi): boolean {
  const refuse = (n: string) => {
    ui.note(n);
    return false;
  };
  if (tooLong(text)) return refuse(TOO_LONG_NOTE);
  const terminal = deps.terminalOf(key);
  if (terminal === undefined) return refuse(NO_TERMINAL_NOTE);
  const why = holdFor(key, deps.stateOf, terminal);
  if (why !== undefined) return refuse(why);
  ui.note(null);
  ui.onQueued();
  let waited = false;
  const onWait = (n: string) => {
    waited = true;
    ui.note(n);
  };
  sendToPane(key, agent, text, { ...deps, onWait }).then(
    (got) => {
      if (got === "sent") return void (waited && ui.note(null));
      if (got === "cancelled" && ui.onCancelled) {
        ui.onCancelled();
        return ui.note(CANCELLED_NOTE);
      }
      ui.onFailed();
      ui.note(outcomeNote(got, key, deps));
    },
    () => {
      ui.onFailed();
      ui.note(FAILED_NOTE);
    },
  );
  return true;
}

/** CHAT-018: the key that interrupts the agent. Claude Code and Codex both take Escape while a turn runs; Escape only ever
 * backs out of a menu, so a Stop that lands in one cannot approve anything. */
export const INTERRUPT_KEY = "\x1b";
export type StopOutcome = "stopped" | "no-terminal" | "asking";
/** CHAT-018: Stop for pane `key`. Any send still waiting in the queue (or half typed) is cancelled first, then the interrupt
 * goes out after whatever write is already in flight. While the agent asks something in its terminal nothing is sent: Escape
 * there would answer the question, and answering is the permission card's job. */
export async function stopPane(key: number, deps: Pick<SendDeps, "terminalOf" | "stateOf" | "write">): Promise<StopOutcome> {
  const terminal = deps.terminalOf(key);
  if (terminal === undefined) return "no-terminal";
  if (asksInTerminal(deps.stateOf?.(key)) || asksInTerminal(heardOf(key))) return "asking";
  cancelQueued(terminal);
  // FIX-1: the interrupt waits behind any write already in flight, and a prompt can open meanwhile; look again at its turn.
  return enqueue<StopOutcome>(terminal, async () => {
    // FIX-2: a program started again (or gone) meanwhile: the Escape would go to a dead session or to one nobody asked to stop.
    if (deps.terminalOf(key) !== terminal) return "no-terminal";
    if (asksInTerminal(deps.stateOf?.(key)) || asksInTerminal(heardOf(key))) return "asking";
    await deps.write(terminal, INTERRUPT_KEY);
    return "stopped";
  });
}

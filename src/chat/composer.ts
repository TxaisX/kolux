// Native chat, the message box and the send path (CHAT-017, CHAT-020, CHAT-027; T-327). Pure rules
// here, the box itself in Composer.tsx: what a key does, the per-pane drafts and history, how a
// message is typed into the agent's terminal, the per-terminal send queue, and when the chat list
// follows new output.
import { BRACKET_CLOSE, BRACKET_OPEN } from "../terminal/paste";

/** CHAT-017: the box grows to about this many lines, then scrolls. */
export const MAX_LINES = 8;
/** CHAT-017: a draft longer than this is not kept (the box still holds it while it is open). */
export const DRAFT_LIMIT = 64 * 1024;
/** CHAT-017: earlier messages kept per pane for the up and down arrows. */
export const HISTORY_LIMIT = 50;
/** CHAT-020: unconfirmed sends kept per pane. */
export const PENDING_LIMIT = 8;
/** CHAT-020: the pause between the pasted text and the Enter that submits it. */
export const ENTER_PAUSE_MS = 300;
/** CHAT-027: within this many pixels of the bottom the view follows new output. */
export const STICK_PX = 48;

export type KeyIn = { key: string; shiftKey?: boolean; ctrlKey?: boolean; altKey?: boolean; metaKey?: boolean; isComposing?: boolean; keyCode?: number };
export type KeyAction = "send" | "newline" | "older" | "newer" | "escape" | null;

/** CHAT-017: what a key in the box does. `atStart` / `atEnd`: the caret is on the first / last line,
 * so the arrows step through history only when they would otherwise leave the box. */
export function keyAction(e: KeyIn, atStart: boolean, atEnd: boolean): KeyAction {
  // An input method editor is composing (Japanese, Chinese…): Enter confirms the word, nothing is sent.
  if (e.isComposing || e.keyCode === 229) return null;
  if (e.key === "Enter") return e.shiftKey ? "newline" : e.ctrlKey || e.altKey || e.metaKey ? null : "send";
  if (e.key === "Escape") return "escape";
  if (e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return null;
  if (e.key === "ArrowUp" && atStart) return "older";
  if (e.key === "ArrowDown" && atEnd) return "newer";
  return null;
}

/** CHAT-017: a key pressed somewhere else in the chat pane that belongs in the box: a printable
 * character (typed there), or Backspace / Delete (which move focus there). */
export function forwardsToBox(e: KeyIn): boolean {
  if (e.ctrlKey || e.altKey || e.metaKey || e.isComposing) return false;
  return e.key === "Backspace" || e.key === "Delete" || [...e.key].length === 1;
}

/** CHAT-017: the box's height in lines for `text` (at least one, at most MAX_LINES). */
export const linesFor = (text: string) => Math.min(MAX_LINES, Math.max(1, text.split("\n").length));

/** CHAT-017: history with `text` added: blank sends are ignored, an exact repeat is stored once
 * (as the newest), and only the newest HISTORY_LIMIT stay. */
export function remember(history: readonly string[], text: string): string[] {
  if (!text.trim()) return history.slice();
  return [...history.filter((h) => h !== text), text].slice(-HISTORY_LIMIT);
}

/** CHAT-017: one step through history. `at` is the index shown (history.length = the draft). */
export function stepHistory(history: readonly string[], at: number, dir: "older" | "newer"): number {
  return dir === "older" ? Math.max(0, at - 1) : Math.min(history.length, at + 1);
}

const drafts = new Map<number, string>();
/** Panes whose box holds text past DRAFT_LIMIT: not kept, but still unsent (TERM-123 keeps such a pane awake). */
const oversize = new Set<number>();
const histories = new Map<number, string[]>();
/** CHAT-017: the unsent draft of pane `key` (kept across tab switches and terminal reconnects). */
export const draftOf = (key: number) => drafts.get(key) ?? "";
export function keepDraft(key: number, text: string) {
  if (!text || text.length > DRAFT_LIMIT) drafts.delete(key);
  else drafts.set(key, text);
  if (text.length > DRAFT_LIMIT) oversize.add(key);
  else oversize.delete(key);
}
/** TERM-123: whether pane `key`'s box holds unsent text, a kept draft or one too long to keep. */
export const hasUnsent = (key: number) => drafts.has(key) || oversize.has(key);
export const historyOf = (key: number) => histories.get(key) ?? [];
export const addHistory = (key: number, text: string) => histories.set(key, remember(historyOf(key), text));

/** CHAT-020: escape and control characters in a message are made harmless (tab and newline stay). */
export const harmless = (text: string) =>
  text
    .replace(/\r\n?/g, "\n")
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, "");

/** CHAT-020: Codex slash commands that open a picker; they are typed as keys, not pasted. */
export const CODEX_PICKERS = ["/model", "/approvals", "/permissions", "/resume", "/theme", "/mcp", "/agent"];

/** One write to the agent's terminal and the pause after it. */
export type Step = { data: string; waitMs: number };

/** CHAT-020: how a message is typed into `agent`'s input line: the line is cleared, the text goes in
 * (a bracketed paste when it spans lines), and Enter follows after a short pause. */
export function sendSteps(agent: string | undefined, raw: string): Step[] {
  const text = harmless(raw).replace(/^\n+|\n+$/g, "");
  if (!text.trim()) return [];
  const clear: Step = { data: "\x15", waitMs: 30 };
  const enter: Step = { data: "\r", waitMs: 0 };
  const word = text.trim().split(/\s/)[0];
  if (agent === "codex" && !text.includes("\n") && CODEX_PICKERS.includes(word)) {
    // Council FIX-3 (AFTER 1 of e5412ff): typed key by key, a Tab would be the Tab key itself.
    const keys = [...text.trim().replace(/\t/g, " ")];
    return [clear, ...keys.map((ch, i) => ({ data: ch, waitMs: i === keys.length - 1 ? ENTER_PAUSE_MS : 15 })), enter];
  }
  // Council FIX-1: a one-line body goes in as a paste too, so a menu that opened before the hook
  // reported it never reads its first letter ("y", "1") as a pick. A one-line slash command is typed
  // as text: it never starts with a menu key, and an agent takes a pasted one as plain words.
  const command = !text.includes("\n") && text.trimStart().startsWith("/");
  // Council AFTER 3 (re-review of 8151d6f): typed as text, a Tab would reach the agent as the Tab
  // key (its completion), so a command's tabs go in as spaces.
  const body = command ? text.replace(/\t/g, " ") : BRACKET_OPEN + text.replace(/\n/g, "\r") + BRACKET_CLOSE;
  return [clear, { data: body, waitMs: ENTER_PAUSE_MS }, enter];
}

/** Council FIX-2: how the window's own pastes (Send notes, a kit's role prompt) are typed: always one
 * bracketed paste, even a one-line slash command, then Enter after the pause. `clearLine` empties the
 * input line first (a role prompt into a fresh agent); notes leave what the user typed there. */
export function pasteSteps(raw: string, clearLine = false): Step[] {
  const text = harmless(raw).replace(/^\n+|\n+$/g, "");
  if (!text.trim()) return [];
  const body: Step = { data: BRACKET_OPEN + text.replace(/\n/g, "\r") + BRACKET_CLOSE, waitMs: ENTER_PAUSE_MS };
  return [...(clearLine ? [{ data: "\x15", waitMs: 30 }] : []), body, { data: "\r", waitMs: 0 }];
}

const queues = new Map<number, Promise<unknown>>();
const epochs = new Map<number, number>();
/** CHAT-018: the stop count of a terminal; a send that began under an older count is cancelled. */
export const epochOf = (terminal: number) => epochs.get(terminal) ?? 0;
/** CHAT-018: cancels every send to a terminal that has not typed its Enter yet (queued or mid-way); Stop calls this before its interrupt goes out. */
export const cancelQueued = (terminal: number) => void epochs.set(terminal, epochOf(terminal) + 1);
/** CHAT-020: sends to one terminal run one after another, in the order they were made. */
export function enqueue<T>(terminal: number, job: () => Promise<T>): Promise<T> {
  const run = (queues.get(terminal) ?? Promise.resolve()).then(job, job);
  queues.set(terminal, run.catch(() => {}));
  return run;
}

/** CHAT-022: the hook states in which the agent shows a menu in its terminal (a tool permission,
 * a question): a chat send then would land in that menu, and its Enter would pick the default. */
export const asksInTerminal = (state: string | undefined) => state === "permission" || state === "waiting";
/** CHAT-022: what the box says while the agent is asking something in its terminal. */
export const ASKING_NOTE = "The agent is asking something in its terminal. Answer there.";

/** CHAT-020: types `steps` with `write`, waiting between them. CHAT-022: `stop` is asked before
 * every write; once it says yes the rest (the Enter above all) is dropped and false comes back.
 * `before` runs ahead of each step's stop check (council FIX-2: the wait after a tool starts). */
export async function typeSteps(steps: Step[], write: (data: string) => Promise<unknown>, sleep = (ms: number) => new Promise((r) => setTimeout(r, ms)), stop: () => boolean = () => false, before?: (s: Step, i: number) => Promise<unknown>): Promise<boolean> {
  for (const [i, s] of steps.entries()) {
    if (before) await before(s, i);
    if (stop()) return false;
    await write(s.data);
    if (s.waitMs) await sleep(s.waitMs);
  }
  return true;
}

/** CHAT-027: the view is close enough to the bottom to follow new output. */
export const nearBottom = (el: { scrollHeight: number; scrollTop: number; clientHeight: number }) => el.scrollHeight - el.scrollTop - el.clientHeight <= STICK_PX;

// Chat panes, the live stream (slice 1 of docs/research/chat-pane-plan-2026-11-20.md). The Rust engine
// reads each line Claude writes to its hidden process and sends it to the page as one `chat-event`;
// this module turns that event into the rows the existing chat view draws (model.ts `ChatItem`,
// steps.ts `fold`). Rust has already named every tool call, capped its output and turned a to-do list
// or plan into Markdown, so the work left here is ids and times, plus the two joins: a tool result onto
// the call it answers and the echoed user message that confirms a send. Nothing is rendered here, and
// nothing is written to a transcript: the event stream is the conversation.
import type { ChatItem } from "../model";
import type { Tool } from "../steps";
import { shortTokens } from "../../usage/meter";

/** One content block of an assistant message (Rust `chat_engine::events::Block`). */
export type Block =
  | { type: "text"; text: string }
  | { type: "thinking"; text: string }
  | { type: "toolUse"; id: string; name: string; input?: unknown; step?: Step }
  | { type: "other"; raw?: unknown };

/** What a tool call became in Rust: the tool row, or Markdown for a plan (CHAT-012). */
export type Step = { kind: "tool"; tool: Tool } | { kind: "plan"; text: string; perTurn?: boolean };

/** One tool result: the call it answers and the text it left. */
export type ToolResult = { toolUseId: string; output: string; isError: boolean };

/** One `chat-event` payload as the page hears it (`chatId` beside the event's own fields). Every field
 *  past `kind` is optional on purpose: an event the engine later grows a field for still reads here. */
export type ChatEvent = {
  chatId: string;
  kind: "started" | "init" | "assistant" | "user" | "compactBoundary" | "permissionDenied" | "apiRetry" | "result" | "stderr" | "exit" | "stopped" | "handoff" | "raw";
  /** `assistant`: the message's blocks, in the order the agent wrote them. */
  blocks?: Block[];
  /** `assistant` and `user`: the subagent (Task) call this belongs to; null in the main conversation. */
  parentToolUseId?: string | null;
  /** `init`: the conversation id the agent opened; a kept Everyday chat saves it to resume later. */
  sessionId?: string;
  /** `started`: the conversation the process picked up with `--resume`, when it resumed one. */
  resumed?: string;
  /** `assistant`: the message's own id; its blocks share it. */
  messageId?: string | null;
  /** `assistant` and `apiRetry`: what the agent itself said went wrong. */
  error?: string | null;
  /** `user`: the message's text, as the agent echoes it back. */
  text?: string[];
  /** `user`: tool results, which belong on their call's row. */
  toolResults?: ToolResult[];
  /** `result`: how the turn ended (`success`, `error_during_execution`, ...). */
  subtype?: string;
  isError?: boolean;
  /** `result`: the error result's own words, behind Details. */
  errors?: string[];
  /** `permissionDenied`: what was refused, and why. */
  toolName?: string;
  decisionReason?: string | null;
  message?: string | null;
  /** `compactBoundary`: what compacted the conversation, and how many tokens it held. */
  trigger?: string | null;
  preTokens?: number;
  /** `apiRetry`: how far into the retries this is. */
  attempt?: number;
  maxRetries?: number;
  errorStatus?: number;
  /** `exit`: the exit code and why the process ended. */
  code?: number | null;
  /** `started` and `exit`: the process's own id, so a late exit of a process already replaced is told
   *  apart from the exit of the one running now. */
  pid?: number;
  reason?: string;
  /** `handoff`: the reading that crossed the handoff line, and the line itself. */
  tokens?: number;
  at?: number;
  /** `stopped`: how the turn was stopped (`interrupt` or `ended`). */
  how?: string;
  /** `stderr`: one line the process printed. */
  line?: string;
};

const pad = (n: number) => String(n).padStart(3, "0");

/** A block's row id: its message's id and the block's place. A line that arrives twice replaces its row
 *  instead of adding a second one, and past nine blocks they still sort in the order they were written. */
const blockId = (ev: ChatEvent, i: number, seq: number) => `${ev.messageId ?? `a-${seq}`}:${pad(i)}`;

/** A row under its own id: the same id twice replaces, as model.ts `applyRead` does for a transcript. */
function put(out: ChatItem[], item: ChatItem): void {
  const i = out.findIndex((x) => x.id === item.id);
  if (i >= 0) out[i] = item;
  else out.push(item);
}

/**
 * The agent conversation an event says the chat is now on: the id an init line or a resumed start names,
 * `null` after a handoff (the old conversation is over, so nothing may resume it again), and `undefined`
 * when the event says nothing about it.
 */
export function sessionChange(ev: ChatEvent): string | null | undefined {
  if (ev.kind === "init" && ev.sessionId) return ev.sessionId;
  if (ev.kind === "started" && ev.resumed) return ev.resumed;
  if (ev.kind === "handoff") return null;
  return undefined;
}

/** A user turn's text without the one leading `<system-reminder>` envelope the engine puts the handoff
 *  note in: the chat shows only what the user wrote. A "<system-reminder>" the user typed anywhere else
 *  stays visible, since only a leading, closed envelope is taken off. */
export function userWords(text: string): string {
  const words = text.replace(/^\s*<system-reminder>[\s\S]*?<\/system-reminder>\s*/, "");
  return words.trim() ? words : "";
}

/** The page's count of messages sent and not yet answered, after one event. Claude Code answers each
 *  queued message with a result of its own, so the working line stays until the count is back to 0. A
 *  stop, or the process ending, leaves nothing waiting (a stop cancels what was queued). A reply while
 *  nothing is waiting is a turn the page did not count (a message sent after a Stop, or a turn the agent
 *  started itself), so it waits for that turn's result; a subagent's reply is not a new turn. */
export function stillWaiting(waiting: number, ev: ChatEvent): number {
  if (ev.kind === "result") return Math.max(0, waiting - 1);
  if (ev.kind === "stopped" || ev.kind === "exit") return 0;
  if (ev.kind === "assistant" && !ev.parentToolUseId && waiting === 0) return 1;
  return waiting;
}

/** An exit of a process the pane has already replaced (its pid is not the last one started): the pane
 *  ignores it, so it neither closes the running turn nor reports a crash of the process running now. */
export function staleExit(ev: ChatEvent, lastPid: number | null): boolean {
  return ev.kind === "exit" && ev.pid !== undefined && lastPid !== null && ev.pid !== lastPid;
}

/**
 * Folds one `chat-event` into the conversation. `at`: when it arrived (ms since 1970), since the engine's
 * events carry no time of their own; `seq`: a counter the caller keeps, so two events the agent gives no
 * id still get stable, different row ids. Returns `prev` itself when the event draws nothing, so a
 * chatty stream does not redraw the list.
 */
export function reduce(prev: readonly ChatItem[], ev: ChatEvent, at: number, seq: number): ChatItem[] {
  switch (ev.kind) {
    case "assistant":
      return said(prev, ev, at, seq) ?? (prev as ChatItem[]);
    case "user":
      return heard(prev, ev, at, seq) ?? (prev as ChatItem[]);
    case "result":
      return ended(prev, ev, at, seq) ?? (prev as ChatItem[]);
    case "permissionDenied":
      return [...prev, denied(ev, at, seq)];
    case "compactBoundary":
      return [...prev, { id: `compact-${seq}`, role: "status", kind: "compact", text: "The conversation was compacted here.", at }];
    // A chat handed off at the context line: its process ended and the next message starts a fresh
    // conversation, so the chat says why its replies stop carrying the old context.
    case "handoff":
      return [...prev, { id: `handoff-${seq}`, role: "status", kind: "notice", text: `Handed off at ${shortTokens(ev.tokens ?? ev.at ?? 0)} tokens. Your next message starts a fresh conversation.`, at }];
    case "apiRetry":
      return [...prev, retry(ev, at, seq)];
    case "exit":
      return ev.reason === "crashed" ? [...prev, crashed(ev, at, seq)] : (prev as ChatItem[]);
    default:
      // started, init, stopped, stderr and raw: the pane hears these, the conversation does not.
      return prev as ChatItem[];
  }
}

/** An assistant message's blocks: the reply's text, its thoughts, each tool call and each plan. */
function said(prev: readonly ChatItem[], ev: ChatEvent, at: number, seq: number): ChatItem[] | null {
  // A subagent's own words are summed up by its Task call's row (CHAT-015, as the transcript chat does),
  // so only the main conversation's blocks become rows of their own.
  if (ev.parentToolUseId) return null;
  const out = prev.slice();
  (ev.blocks ?? []).forEach((b, i) => {
    const id = blockId(ev, i, seq);
    if (b.type === "text" && b.text.trim()) put(out, { id, role: "assistant", kind: "text", text: b.text, at });
    else if (b.type === "thinking" && b.text.trim()) put(out, { id, role: "assistant", kind: "thought", text: b.text, at });
    else if (b.type === "toolUse" && b.step?.kind === "tool") {
      const tool = b.step.tool;
      // The call's own id is what its result names; a reading that lost it still gets one from the block.
      put(out, { id, role: "assistant", kind: "tool", text: tool.preview, at, tool: { ...tool, call: tool.call || b.id } });
    } else if (b.type === "toolUse" && b.step?.kind === "plan") put(out, { id, role: "assistant", kind: "plan", text: b.step.text, at });
  });
  if (ev.error) put(out, { id: `error-${ev.messageId ?? seq}`, role: "status", kind: "notice", text: "Claude's reply carried an error.", details: ev.error, at });
  return (ev.blocks ?? []).length > 0 || ev.error ? out : null;
}

/** A user message's echo and the results of the tool calls the agent made. */
function heard(prev: readonly ChatItem[], ev: ChatEvent, at: number, seq: number): ChatItem[] | null {
  let out = prev as ChatItem[];
  let touched = false;
  const copy = () => {
    if (touched) return;
    out = prev.slice();
    touched = true;
  };
  // The message a box sent comes back here, so the waiting row it left is confirmed from the same rules
  // every transcript read uses (model.ts `combine` / `sentIn`).
  (ev.text ?? []).forEach((raw, i) => {
    const text = userWords(raw);
    if (!text) return;
    copy();
    put(out, { id: `u-${seq}-${i}`, role: "user", kind: "text", text, at });
  });
  for (const r of ev.toolResults ?? []) {
    const i = out.findIndex((x) => x.tool?.call === r.toolUseId);
    // A call this page never drew: a subagent's, or one made before the pane opened. Its result has no row.
    if (i < 0) continue;
    copy();
    out[i] = { ...out[i], tool: { ...out[i].tool!, output: r.output, done: true, failed: r.isError, endedAt: at } };
  }
  return touched ? out : null;
}

/** A turn's end: only the endings the reply itself does not say leave a row. */
function ended(prev: readonly ChatItem[], ev: ChatEvent, at: number, seq: number): ChatItem[] | null {
  if (!ev.isError) return null;
  // A stop ends the turn with this subtype; the row marks the turn so no "Worked for" line is claimed for it.
  if (ev.subtype === "error_during_execution") return [...prev, { id: `stopped-${seq}`, role: "assistant", kind: "interrupted", text: "Interrupted before it finished.", at }];
  return [...prev, { id: `result-${seq}`, role: "status", kind: "notice", text: `The turn ended with an error (${ev.subtype || "unknown"}).`, details: (ev.errors ?? []).join("\n") || undefined, at }];
}

/** A tool call the agent's own permission rules refused (slice 4 draws the real cards). */
function denied(ev: ChatEvent, at: number, seq: number): ChatItem {
  const details = [ev.message, ev.decisionReason].filter((x): x is string => !!x).join("\n");
  return { id: `denied-${seq}`, role: "status", kind: "notice", text: `Claude was not allowed to use ${ev.toolName || "a tool"}.`, ...(details ? { details } : {}), at };
}

/** An API call that failed and will be tried again: a silent wait looks like a hang. */
function retry(ev: ChatEvent, at: number, seq: number): ChatItem {
  const code = ev.errorStatus ? ` (${ev.errorStatus}${ev.error ? ` ${ev.error}` : ""})` : ev.error ? ` (${ev.error})` : "";
  const tries = ev.attempt ? `, attempt ${ev.attempt}${ev.maxRetries ? ` of ${ev.maxRetries}` : ""}` : "";
  return { id: `retry-${seq}`, role: "status", kind: "text", text: `The request to Claude failed${code}. Trying again${tries}.`, at };
}

/** A process that ended by itself with a bad code: the next message starts it again (the engine resumes). */
function crashed(ev: ChatEvent, at: number, seq: number): ChatItem {
  const code = ev.code === undefined || ev.code === null ? "" : ` (code ${ev.code})`;
  return { id: `exit-${seq}`, role: "status", kind: "notice", text: `Claude's process ended${code}. Your next message starts it again.`, at };
}

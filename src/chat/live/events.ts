// Chat panes, the live stream (slice 1 of docs/research/chat-pane-plan-2026-11-20.md). The Rust engine
// reads each line Claude writes to its hidden process and sends it to the page as one `chat-event`;
// this module turns that event into the rows the existing chat view draws (model.ts `ChatItem`,
// steps.ts `fold`). Rust has already named every tool call, capped its output and turned a to-do list
// or plan into Markdown, so the work left here is ids and times, plus the two joins: a tool result onto
// the call it answers and the echoed user message that confirms a send. Nothing is rendered here, and
// nothing is written to a transcript: the event stream is the conversation.
import type { ChatItem } from "../model";
import type { Tool } from "../steps";

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
  kind: "started" | "init" | "assistant" | "user" | "compactBoundary" | "permissionDenied" | "apiRetry" | "result" | "stderr" | "exit" | "stopped" | "raw";
  /** `assistant`: the message's blocks, in the order the agent wrote them. */
  blocks?: Block[];
  /** `assistant` and `user`: the subagent (Task) call this belongs to; null in the main conversation. */
  parentToolUseId?: string | null;
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
  reason?: string;
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
  (ev.text ?? []).forEach((text, i) => {
    if (!text.trim()) return;
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

// Native chat, the window side (CHAT-002, CHAT-010, CHAT-011; T-325). The Rust side
// (`src-tauri/src/chat.rs`) finds and follows the agent's transcript and hands over plain
// messages; this module decides whether a pane may show chat at all, folds each read into the
// conversation, merges in what the hooks and the terminal said, and decides when the live preview
// of a reply being written is worth showing.
import { DRAFT_LIMIT } from "./composer";
import type { Tool } from "./steps";

/** One message as the transcript reader hands it over. */
export type ChatItem = {
  id: string;
  role: "user" | "assistant" | "status";
  /** `text`, `command` (a slash command or skill the user typed), `interrupted`, `thought`, `tool`,
   * `plan` (Markdown), `compact` or `notice` (T-326). */
  kind: string;
  text: string;
  /** Milliseconds since 1970. */
  at?: number;
  images?: string[];
  tool?: Tool;
  /** A notice's full text, behind Details. */
  details?: string;
};

/** One look at the transcript (Rust `ChatRead`). */
export type ChatRead = {
  state: "loading" | "ready" | "empty" | "error";
  reset: boolean;
  items: ChatItem[];
  open: boolean;
  error?: string;
  retryMs: number;
  /** CHAT-008: the byte cursor of the lines before the first one read (on a reset read); absent at the top of the transcript. */
  older?: number;
  /** CHAT-008: `items` are an older page, to go before what the view holds; `older` is the next cursor. */
  earlier?: boolean;
};

/** CHAT-002: the agents whose sessions can be shown as chat (Grok waits for a public description of its session files, T-325-b). */
export const CHAT_AGENTS = ["claude", "openclaude", "codex", "omp"] as const;

export type OfferInput = {
  /** The agent Kolux credits with the program running in the pane (Rust `chat_support`). */
  credited: string | null | undefined;
  /** The tab's title and the launch hint are listed only to say they never unlock chat. */
  title?: string;
  hint?: string;
  screen: "agents" | "terminals";
  /** The experimental chat switch (CHAT-001); the Agents screen does not need it. */
  switchOn: boolean;
  /** The tab is showing chat right now. */
  showingChat: boolean;
  /** The pane's program has not come up yet. */
  launching: boolean;
  /** A home folder for the agent's transcripts exists on this computer. */
  readable: boolean;
  /** A structured session: Kolux runs the agent with no terminal behind it. */
  structured?: boolean;
};

/** What a pane offers: chat, a way back to its terminal, or the still-launching chooser. */
export type Offer = { chat: boolean; back: boolean; chooser: boolean };

/** CHAT-002: whether a pane may show chat, by the agent actually running in it. */
export function chatOffer(o: OfferInput): Offer {
  if (o.structured) return { chat: true, back: false, chooser: false };
  if (o.launching && o.screen === "agents") return { chat: false, back: false, chooser: true };
  const supported = (CHAT_AGENTS as readonly string[]).includes(o.credited ?? "") && o.readable;
  const chat = supported && (o.screen === "agents" || o.switchOn);
  // A tab already showing chat can always go back to its terminal, even if support was lost.
  return { chat, back: o.showingChat, chooser: false };
}

/** VIEW-019: which chat the Agents screen shows. With a pane picked, only that pane: its chat when
 * it can show one, "starting" while it launches or its support is not known yet, else none (its
 * terminal shows), so the box never types into a pane the rail did not pick. With nothing picked,
 * the first pane that can show chat. */
export function pickChat<P extends { key: number }>(panes: P[], focused: number | null, offers: Record<number, Offer | undefined>): P | "starting" | null {
  if (focused === null) return panes.find((p) => offers[p.key]?.chat) ?? null;
  const p = panes.find((x) => x.key === focused);
  if (!p) return null;
  const o = offers[p.key];
  if (o?.chat) return p;
  return !o || o.chooser ? "starting" : null;
}

/** T-050-b (VIEW-019): a plain shell, a pane Kolux started no program in, offers no chat and never
 * waits as "starting": its terminal shows, with no Show terminal switch. */
export const SHELL_OFFER: Offer = { chat: false, back: false, chooser: false };

/** What Rust `chat_support` says about a pane: the agent it goes by (T-050-c: the one detected in
 * front of the pane's terminal, else the launch record), whether the launch is still coming up, and
 * whether a transcript home for that agent exists here. */
export type Support = { agent?: string; launching: boolean; readable: boolean };

/** T-050-c (VIEW-019): a pane's offer on the Agents screen from what is live in it. The agent in
 * `support` already weighs the detected agent over the launch record, so a shell where the user
 * typed `claude`, an orchestrator worker and a typed-command pane (program null) offer chat once an
 * agent is in front and go back to the terminal when it exits; a launch whose program changed
 * follows the new agent. Only a pane Kolux started a program in can be "starting": a shell with
 * nothing in front is a plain shell, never the chooser. */
export function liveOffer(program: string | null | undefined, title: string | undefined, support: Support): Offer & { agent?: string } {
  const launching = support.launching && program != null;
  return { agent: support.agent, ...chatOffer({ credited: support.agent, title, screen: "agents", switchOn: false, showingChat: false, launching, readable: support.readable }) };
}

/** T-050-b (VIEW-019): what the Agents screen's body shows for what pickChat chose. "chat": the
 * chat with the Show terminal switch off; "terminal": the terminal with the switch on (the user
 * forced it for this session); "starting": the launch line; "none": the terminal and no switch. */
export function agentsView<P extends { key: number }>(shown: P | "starting" | null, forced: ReadonlySet<number>): "chat" | "terminal" | "starting" | "none" {
  if (shown === null) return "none";
  if (shown === "starting") return "starting";
  return forced.has(shown.key) ? "terminal" : "chat";
}

/** T-809 (P4a-12): the line over a pane the Agents screen is waiting on: "Ended" once its process is gone, never "Starting…" over an ended pane. */
export const startingLine = (ended: boolean): string => (ended ? "Ended" : "Starting…");

/** T-050-b: the chat covers the terminal only once the transcript is found; before that (and when
 * it cannot be read) the chat's line and box sit above the terminal, so a prompt the agent shows at
 * launch, before its first turn is written, stays in sight. */
export const chatCovers = (state: ChatRead["state"]) => state === "ready" || state === "empty";

/** VIEW-020 (T-080): how many sessions the hand-off list offers. */
export const HAND_CAP = 5;

/** VIEW-020: where a finished session's result can go: the other sessions that can show chat, the
 * last viewed first (`viewed` is newest first), the never-viewed after them in pane order, capped. */
export function handTargets<P extends { key: number }>(panes: P[], from: number, offers: Record<number, Offer | undefined>, viewed: readonly number[]): P[] {
  const rank = (k: number) => (viewed.includes(k) ? viewed.indexOf(k) : viewed.length);
  const out = panes.filter((p) => p.key !== from && offers[p.key]?.chat).map((p, i) => ({ p, i }));
  out.sort((a, b) => rank(a.p.key) - rank(b.p.key) || a.i - b.i);
  return out.slice(0, HAND_CAP).map((x) => x.p);
}

/** VIEW-020: the viewing order with `key` moved to the front. */
export const viewedFirst = (viewed: readonly number[], key: number) => [key, ...viewed.filter((k) => k !== key)];

/** VIEW-020: a result as it is handed over: a line that is a whole file path with a space in it
 * arrives quoted, so the target agent reads it as one path; everything else is untouched.
 * ponytail: a line test (drive, ~, UNC or two slashes; no end punctuation), not a path parser. */
export const handText = (result: string) =>
  result
    .split("\n")
    .map((line) => {
      const t = line.trim();
      return t.includes(" ") && /^([A-Za-z]:[\\/]|~[\\/]|\\\\|\/[^/\s]+\/)\S/.test(t) && !/[.!?:,;]$/.test(t) && !t.includes(": ") ? line.replace(t, () => `"${t}"`) : line;
    })
    .join("\n");

/** VIEW-020: what the user already typed in the target's box stays, the result goes after it. */
export const handInto = (draft: string, text: string) => (draft.trim() ? `${draft.trimEnd()}\n\n${text}` : text);

/** Stand-in review of 38be105, FIX-SOON 1: the note when a result plus the target's draft is longer than a draft can be. */
export const handTooLongText = (label: string) => `That result is too long to add to ${label}'s box beside what is typed there. Nothing was sent and the draft is kept.`;

export type HandDeps = { draftOf: (key: number) => string; keepDraft: (key: number, text: string) => void; pick: (key: number) => void; say: (text: string) => void };
/** VIEW-020: puts `result` after the draft kept for `to` and moves the screen there. When the two
 * together are longer than DRAFT_LIMIT (keepDraft would delete the draft, VIEW-020 keeps it), the
 * draft stays as it is, `say` tells why, and the screen stays. Nothing is ever written to a terminal.
 * True when it was handed over. */
export function handOver(to: number, label: string, result: string, io: HandDeps): boolean {
  const merged = handInto(io.draftOf(to), handText(result));
  if (merged.length > DRAFT_LIMIT) {
    io.say(handTooLongText(label));
    return false;
  }
  io.keepDraft(to, merged);
  io.pick(to);
  return true;
}

/** Council FIX-1: with nothing picked, the box types into the first pane that can chat, so it says
 * which one; with a pane picked the rail already shows it. */
export const typingInto = (focused: number | null, pane: { title?: string }) => (focused === null ? `Typing into ${pane.title?.trim() || "the first agent that can chat"}` : null);

/** Folds one read into the conversation: a reset replaces it, otherwise items with a known id
 * replace their old version and new ones join, in transcript order. */
export function applyRead(prev: ChatItem[], read: ChatRead): ChatItem[] {
  if (read.reset) return read.items;
  if (read.items.length === 0) return prev;
  const out = prev.slice();
  for (const item of read.items) {
    const i = out.findIndex((x) => x.id === item.id);
    if (i >= 0) out[i] = item;
    else out.push(item);
  }
  return out;
}

/** A message the hooks reported (the prompt, the last reply) before the transcript had it. */
export type Extra = { id: string; role: "user" | "assistant"; text: string; at: number };
/** Something typed from chat that the transcript has not confirmed yet. */
export type Pending = { id: string; text: string; at: number; failed?: boolean };
/** A row of the conversation as drawn. */
export type Row = (ChatItem & { row: "message" }) | { row: "preview"; id: string; text: string } | { row: "pending"; id: string; text: string; at: number; failed?: boolean };

const norm = (s: string) => s.replace(/\s+/g, " ").trim();
/** How far back a confirmed send may be timestamped from when it was typed. */
const SEND_SLACK_MS = 5_000;

/** CHAT-010: the transcript's messages, plus hook messages it does not have yet, each once, in
 * time order (then by identity); the streaming preview after real content; sends not yet
 * confirmed last. */
export function combine(transcript: ChatItem[], extras: Extra[], preview: string | null, pending: Pending[]): Row[] {
  const has = (role: string, text: string) => transcript.some((t) => t.role === role && norm(t.text) === norm(text));
  const real: ChatItem[] = [...transcript, ...extras.filter((e) => !has(e.role, e.text)).map((e) => ({ ...e, kind: "text" }))];
  const order = real.map((item, i) => ({ item, i }));
  order.sort((a, b) => (a.item.at ?? 0) - (b.item.at ?? 0) || (a.item.id < b.item.id ? -1 : a.item.id > b.item.id ? 1 : a.i - b.i));
  const rows: Row[] = order.map(({ item }) => ({ ...item, row: "message" as const }));
  if (preview) rows.push({ row: "preview", id: "preview", text: preview });
  for (const p of pending) {
    const confirmed = transcript.some((t) => t.role === "user" && sentIn(t.text, p.text) && (t.at ?? Infinity) >= p.at - SEND_SLACK_MS);
    if (!confirmed) rows.push({ row: "pending", id: p.id, text: p.text, at: p.at, failed: p.failed });
  }
  return rows;
}

/** CHAT-020: a send shows up in a recorded user turn: the same text, or its lines inside a turn
 * that merged two quick sends. */
export function sentIn(turn: string, sent: string): boolean {
  if (norm(turn) === norm(sent)) return true;
  const lines = (t: string) => t.split(/\r?\n/).map(norm).filter(Boolean);
  const a = lines(turn);
  const b = lines(sent);
  if (b.length === 0 || b.length >= a.length) return false;
  return a.some((_, i) => b.every((l, j) => a[i + j] === l));
}

/** CHAT-020: the unconfirmed sends a pane keeps, newest last, at most `limit`. */
export const capPending = (list: Pending[], limit = 8) => list.slice(-limit);

/** A live preview of the reply being written, scraped while the turn runs (T-421 feeds it). */
export type Preview = { text: string; tool?: boolean };

/** CHAT-011: the preview is shown only during an active turn, only when it runs ahead of the
 * transcript's last reply, and never when it is tool output or blank. */
export function previewToShow(preview: Preview | null, turnOpen: boolean, lastReply: string | undefined): string | null {
  if (!preview || !turnOpen || preview.tool) return null;
  const text = preview.text.trim();
  if (!text) return null;
  if (lastReply !== undefined && text.length <= norm(lastReply).length) return null;
  return text;
}

/** The last thing the agent said, for the preview comparison. */
export function lastReply(items: ChatItem[]): string | undefined {
  return lastReplyItem(items)?.text;
}
/** The item behind `lastReply`: its id tells two replies with the same words apart (FIX-6, review of 64abfea0 AFTER 2). */
export function lastReplyItem(items: ChatItem[]): ChatItem | undefined {
  for (let i = items.length - 1; i >= 0; i--) {
    if (items[i].role === "user") return undefined;
    if (items[i].role === "assistant" && items[i].kind === "text") return items[i];
  }
  return undefined;
}

/** CHAT-010: a message's time, in the app's language (short on the row, full on hover). */
export function stamp(at: number, locale: string): { short: string; full: string } {
  const d = new Date(at);
  return {
    short: new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit" }).format(d),
    full: new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "medium" }).format(d),
  };
}

// Chat panes, the engine's side (slice 1 of docs/research/chat-pane-plan-2026-11-20.md). One chat is one
// conversation the Rust engine owns: an OpenCode session on the engine's shared OpenCode server
// (2026-11-24), or a hidden `claude` process; the page drives it with four commands that already
// exist (`chat_start`, `chat_send`, `chat_stop`, `chat_end`) and hears it back on one event. Nothing here
// decides what a message is: it names the chat, passes the text and hands the event on. The contract is
// docs/chat-engine.md.
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { ChatEvent } from "./events";
import type { ChatRead } from "../model";
import { setChatModels } from "../controls";
import { CHAT_AGENT, listChatModels } from "../opencode";

/** The one Tauri event every chat's events arrive on; each payload names its chat. */
export const CHAT_EVENT = "chat-event";

/** How `chat_stop` ended the turn: the agent ended it itself, or its process had to be ended. */
export type StopHow = "interrupt" | "ended";

/** A pane's chat id. It is the pane's own key, so a layout brings a chat back under the same name and two
 *  panes can never talk to one process. */
export const chatIdOf = (paneKey: number): string => `pane-${paneKey}`;

/**
 * Opens the chat in `cwd`, which must be an existing folder. `agent` is `opencode` for a chat that runs
 * through OpenCode (2026-11-24: every model the chat page offers), or `claude` for Claude Code's own
 * hidden process; the sign-in and the user's own setup come from the Rust side. `resumeSessionId` picks
 * up a kept conversation where it stopped. `model` and `effort` are what the conversation runs at:
 * calling this again for the same chat and conversation with another pair changes them in place on
 * OpenCode, with no restart.
 */
export async function startChat(chatId: string, cwd: string, model: string | null = null, agent: string = "claude", resumeSessionId: string | null = null, effort: string | null = null): Promise<void> {
  const engine = agent === "claude" ? agent : CHAT_AGENT;
  // The controls beside Send list what OpenCode lists. The list is asked for once and is not waited for.
  if (engine === CHAT_AGENT) void listChatModels().then((list) => (list.length > 0 ? setChatModels(list) : undefined));
  await invoke("chat_start", { chatId, cwd, model, effort, resumeSessionId, extraEnv: [], agent: engine });
}

/** OpenCode ids all begin `ses_`; a Claude Code conversation id is a bare UUID. */
export const isOpenCodeSession = (id: string): boolean => id.startsWith("ses_");

/** The engine's answers for a chat that is not there ("... is not in OpenCode anymore.", "... not on this computer anymore."). */
const isGoneAnswer = (e: unknown): boolean => /\banymore\b|is not a session id/i.test(String(e));

/**
 * A kept chat's transcript, for opening it again. An OpenCode chat is read from OpenCode. An older Everyday
 * chat (kept before every chat ran through OpenCode, 2026-11-24) holds a Claude Code id that OpenCode does not
 * know: its own transcript file is read instead, and `legacy` says the chat cannot be continued, only shown.
 * `read` is null when nothing could be read; the pane then says so rather than starting fresh without a word.
 * `unreachable` (review 2 P3-11) tells "OpenCode could not be asked" from "OpenCode says the chat is gone": only
 * the engine's own "... anymore." answers mean gone, so any other failure keeps the id and offers a retry.
 */
export async function readKeptChat(cwd: string, session: string): Promise<{ read: ChatRead | null; legacy: boolean; unreachable?: true }> {
  let unreachable = false;
  const fromOpenCode = await chatHistory(CHAT_AGENT, cwd, session).catch((e) => {
    if (!isGoneAnswer(e)) unreachable = true;
    return null;
  });
  if (fromOpenCode) return { read: fromOpenCode, legacy: false };
  if (isOpenCodeSession(session)) return unreachable ? { read: null, legacy: false, unreachable: true } : { read: null, legacy: false };
  const fromClaude = await chatHistory("claude", cwd, session).catch(() => null);
  return { read: fromClaude, legacy: true };
}

/**
 * What a kept conversation already said (2026-11-21). A resumed conversation does not say its history
 * again, so the chat page reads it once and opens on it: from OpenCode for an OpenCode chat, from the
 * agent's own transcript file otherwise.
 */
export async function chatHistory(agent: string, cwd: string, session: string, limit?: number): Promise<ChatRead> {
  return invoke<ChatRead>("chat_history", limit === undefined ? { agent, cwd, session } : { agent, cwd, session, limit });
}

/**
 * Sends one message. Attachments are already at the end of `text` as their paths (attach.ts `withPaths`),
 * which is how the agent reads a file; an image pasted from the clipboard is saved first and arrives the
 * same way, so nothing here has to carry base64.
 */
export async function sendChat(chatId: string, text: string): Promise<void> {
  await invoke("chat_send", { chatId, text, images: [] });
}

/** Stops the running turn. `null` when no turn was running, so a Stop on a finished turn says nothing. */
export async function stopChat(chatId: string): Promise<StopHow | null> {
  return (await invoke<StopHow | null>("chat_stop", { chatId })) ?? null;
}

/**
 * Ends the chat and its process: the pane is going away. The engine drops the session id with it, so the
 * next chat opens a fresh conversation (keeping it for a restart is slice 2).
 */
export async function endChat(chatId: string): Promise<void> {
  await invoke("chat_end", { chatId });
}

/**
 * Hears one chat's events and ignores every other chat's; resolves to the way to stop hearing them.
 * A payload without a chat id is dropped rather than handed on, so a malformed line cannot draw a row
 * into the wrong pane.
 */
export async function hearChat(chatId: string, onEvent: (ev: ChatEvent) => void): Promise<() => void> {
  return listen<ChatEvent>(CHAT_EVENT, (e) => {
    const ev = e.payload;
    if (!ev || ev.chatId !== chatId) return;
    onEvent(ev);
  });
}

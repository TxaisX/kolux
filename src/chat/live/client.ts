// Chat panes, the engine's side (slice 1 of docs/research/chat-pane-plan-2026-11-20.md). One chat is one
// hidden `claude` process that the Rust engine owns; the page drives it with four commands that already
// exist (`chat_start`, `chat_send`, `chat_stop`, `chat_end`) and hears it back on one event. Nothing here
// decides what a message is: it names the chat, passes the text and hands the event on. The contract is
// docs/chat-engine.md.
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { ChatEvent } from "./events";
import type { ChatRead } from "../model";

/** The one Tauri event every chat's events arrive on; each payload names its chat. */
export const CHAT_EVENT = "chat-event";

/** How `chat_stop` ended the turn: the agent ended it itself, or its process had to be ended. */
export type StopHow = "interrupt" | "ended";

/** A pane's chat id. It is the pane's own key, so a layout brings a chat back under the same name and two
 *  panes can never talk to one process. */
export const chatIdOf = (paneKey: number): string => `pane-${paneKey}`;

/**
 * Opens the chat and starts its hidden process in `cwd`, which must be an existing folder. `agent` is
 * `claude`, or `openclaude` for the other models (2026-11-20); the sign-in and the user's own setup
 * come from the Rust side, and a chat started here is never `--bare`. `resumeSessionId` (2026-11-21)
 * picks up a kept Everyday conversation where it stopped: the agent is started with `--resume`.
 * `effort` (2026-11-21) is the level the conversation runs at; the page restarts the process on the
 * same session when the user picks another model or effort.
 */
export async function startChat(chatId: string, cwd: string, model: string | null = null, agent: string = "claude", resumeSessionId: string | null = null, effort: string | null = null): Promise<void> {
  await invoke("chat_start", { chatId, cwd, model, effort, resumeSessionId, extraEnv: [], agent });
}

/**
 * What a kept conversation already said (2026-11-21). A resumed process reads its history without saying
 * it again, so the chat page reads the agent's own transcript of that session once and opens on it.
 */
export async function chatHistory(agent: string, cwd: string, session: string): Promise<ChatRead> {
  return invoke<ChatRead>("chat_history", { agent, cwd, session });
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

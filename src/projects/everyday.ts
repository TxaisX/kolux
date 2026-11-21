// The Everyday row (2026-11-20): one plain folder above the projects, for daily asks. The path itself is
// decided in Rust (`everyday_path`), so the window never guesses where the user's home is; this file holds
// only the rules the sidebar needs to draw the folder's sessions and to offer a session on any AI.
import type { EverydayChat } from "./everydayChats";
import type { FolderSession } from "./folderSessions";

const norm = (p: string) => p.replace(/[\\/]+$/, "").replace(/\//g, "\\").toLowerCase();

/** Two folder paths name the same place: case and separator insensitive, a trailing slash ignored. */
export const samePlace = (a: string | null | undefined, b: string | null | undefined): boolean => (a && b ? norm(a) === norm(b) : false);

/** True when `path` is the Everyday folder. */
export const isEveryday = (path: string | null | undefined, everydayPath: string | null | undefined): boolean => samePlace(path, everydayPath);

/** The panes in the Everyday folder: one opened there, or one whose grid shows it. */
export const everydaySessions = (sessions: readonly FolderSession[], everydayPath: string | null | undefined): FolderSession[] =>
  everydayPath ? sessions.filter((s) => samePlace(s.cwd, everydayPath) || samePlace(s.view, everydayPath)) : [];

/** One sidebar row: a kept chat with the tab that shows it right now, or no tab (the chat was closed). A
 *  kept chat and its live tab are one row, never two: the pane names the record it draws (`record`). */
export type EverydayItem = { chat: EverydayChat; pane: FolderSession | null };

/**
 * The kept chats, newest first, each paired with its live tab when one is open (2026-11-21). `sessions` is
 * already this folder's panes (everydaySessions), so a chat opened here but drawn in another grid still
 * counts. A chat whose tab is gone keeps its row with `pane: null`.
 */
export function everydayItems(chats: readonly EverydayChat[], sessions: readonly FolderSession[]): EverydayItem[] {
  const byRecord = new Map<string, FolderSession>();
  for (const s of sessions) if (s.record) byRecord.set(s.record, s);
  return chats.map((chat) => ({ chat, pane: byRecord.get(chat.id) ?? null }));
}

/** The Everyday panes no kept chat owns: another AI's session, or a chat opened before chats were kept.
 *  They draw as before, from the open pane alone. */
export const everydayUnkept = (sessions: readonly FolderSession[], chats: readonly EverydayChat[]): FolderSession[] => {
  const kept = new Set(chats.map((c) => c.id));
  const out = sessions.filter((s) => !s.record || !kept.has(s.record));
  return out.length === sessions.length ? (sessions as FolderSession[]) : out;
};

/** The AIs whose Everyday sessions draw the chat page; every other AI opens its own screen. OpenClaude
 *  (2026-11-20) answers the same way in the same bubble view, so it draws the chat page too. */
export const EVERYDAY_CHAT_AGENTS = ["claude", "openclaude"];

export type EverydayModel = { id: string; label: string };
/** One AI in the New session menu, with the models it can start on. */
export type EverydayAgent = { agent: string; name: string; chat: boolean; models: EverydayModel[] };

/**
 * The AIs an Everyday session can start: every installed one, the chat AIs first and the rest in the order
 * the app lists them. An AI with no model list is still offered: its session starts on the program's
 * own default (ACCT-032: an empty list means no model step, so `models` is empty and the menu says so).
 */
export function everydayAgents(installed: readonly { id: string; name: string; installed: boolean }[], modelsOf: (agentId: string) => readonly EverydayModel[]): EverydayAgent[] {
  const out: EverydayAgent[] = [];
  for (const a of installed) {
    if (!a.installed) continue;
    out.push({ agent: a.id, name: a.name, chat: EVERYDAY_CHAT_AGENTS.includes(a.id), models: [...modelsOf(a.id)] });
  }
  // The chat page's AIs first, apps' own order kept inside each group: the list is stable, never resorted by name.
  return [...out.filter((x) => x.chat), ...out.filter((x) => !x.chat)];
}

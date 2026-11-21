// The Everyday row (2026-11-20): one plain folder above the projects, for daily asks. The path itself is
// decided in Rust (`everyday_path`), so the window never guesses where the user's home is; this file holds
// only the rules the sidebar needs to draw the folder's sessions and to offer a session on any AI.
import type { FolderSession } from "./folderSessions";

const norm = (p: string) => p.replace(/[\\/]+$/, "").replace(/\//g, "\\").toLowerCase();

/** Two folder paths name the same place: case and separator insensitive, a trailing slash ignored. */
export const samePlace = (a: string | null | undefined, b: string | null | undefined): boolean => (a && b ? norm(a) === norm(b) : false);

/** True when `path` is the Everyday folder. */
export const isEveryday = (path: string | null | undefined, everydayPath: string | null | undefined): boolean => samePlace(path, everydayPath);

/** The panes in the Everyday folder: one opened there, or one whose grid shows it. */
export const everydaySessions = (sessions: readonly FolderSession[], everydayPath: string | null | undefined): FolderSession[] =>
  everydayPath ? sessions.filter((s) => samePlace(s.cwd, everydayPath) || samePlace(s.view, everydayPath)) : [];

/** The one AI whose Everyday sessions draw the chat page; every other AI opens its own screen. */
export const EVERYDAY_CHAT_AGENT = "claude";

export type EverydayModel = { id: string; label: string };
/** One AI in the New session menu, with the models it can start on. */
export type EverydayAgent = { agent: string; name: string; chat: boolean; models: EverydayModel[] };

/**
 * The AIs an Everyday session can start: every installed one, Claude first and the rest in the order
 * the app lists them. An AI with no model list is still offered: its session starts on the program's
 * own default (ACCT-032: an empty list means no model step, so `models` is empty and the menu says so).
 */
export function everydayAgents(installed: readonly { id: string; name: string; installed: boolean }[], modelsOf: (agentId: string) => readonly EverydayModel[]): EverydayAgent[] {
  const out: EverydayAgent[] = [];
  for (const a of installed) {
    if (!a.installed) continue;
    out.push({ agent: a.id, name: a.name, chat: a.id === EVERYDAY_CHAT_AGENT, models: [...modelsOf(a.id)] });
  }
  // Claude first (the chat page), the rest keep the app's own order: the list is stable, never resorted by name.
  return [...out.filter((x) => x.chat), ...out.filter((x) => !x.chat)];
}

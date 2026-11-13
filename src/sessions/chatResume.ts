// VIEW-086 (T-146-d): resuming a past session as a chat. A chat is the Agents screen reading a
// running agent's own transcript, so "resume as chat" is the terminal resume of T-169 followed by the
// Agents screen coming to the front. This is only the rule for when it is offered: Claude's history
// is kept per folder, so a Claude session resumes as chat only in its own workspace; Codex keeps one
// history, so it resumes from any workspace; remote and WSL sessions are refused.
import { normPath, type Session } from "./model";
import { gridOf } from "../workspaces";

/** The agents the chat screen can read (the Rust side's list), split by how their history is kept. */
const PER_FOLDER = ["claude", "openclaude", "omp"];
const ANYWHERE = ["codex"];

export const NO_CHAT_AGENT = "Chat can only show Claude and Codex sessions, so this one resumes in a terminal.";
export const OTHER_WORKSPACE = "This Claude session belongs to another workspace. Open that workspace to resume it as chat, or resume it in a terminal.";
export const REMOTE_SESSION = "Remote and WSL sessions cannot be resumed as chat. Resume it in a terminal instead.";
export const NO_WORKSPACE = "Open a workspace first, then resume the session as chat in it.";

/** A folder on another machine or in a Linux subsystem: a WSL share, a URL, or user@host:path. */
export const isRemoteDir = (dir: string | null): boolean => {
  if (dir === null) return false;
  const d = dir.trim().replace(/\\/g, "/").toLowerCase();
  return d.startsWith("//wsl$/") || d.startsWith("//wsl.localhost/") || d.startsWith("//?/unc/wsl") || /^[a-z][a-z0-9+.-]+:\/\//.test(d) || /^[^/\s]+@[^/\s]+:/.test(d);
};

/** Why a listed session cannot be resumed as chat, or null when it can. */
export function chatResumeBlock(s: Pick<Session, "agent" | "dir" | "turns">, activeDir: string | null): string | null {
  if (!PER_FOLDER.includes(s.agent) && !ANYWHERE.includes(s.agent)) return NO_CHAT_AGENT;
  if (isRemoteDir(s.dir)) return REMOTE_SESSION;
  if (activeDir === null) return NO_WORKSPACE;
  // One workspace per project: a session of a linked worktree belongs to the project's grid, which is what activeDir names.
  const own = s.dir === null ? null : gridOf(s.dir);
  if (PER_FOLDER.includes(s.agent) && (own === null || normPath(own) !== normPath(activeDir))) return OTHER_WORKSPACE;
  return null;
}

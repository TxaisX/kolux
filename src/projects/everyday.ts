// The Everyday row (2026-11-20): one plain folder above the projects, for daily asks. The path itself is
// decided in Rust (`everyday_path`), so the window never guesses where the user's home is; this file holds
// only the rules the sidebar needs to draw the folder's chats.
import type { FolderSession } from "./folderSessions";

const norm = (p: string) => p.replace(/[\\/]+$/, "").replace(/\//g, "\\").toLowerCase();

/** Two folder paths name the same place: case and separator insensitive, a trailing slash ignored. */
export const samePlace = (a: string | null | undefined, b: string | null | undefined): boolean => (a && b ? norm(a) === norm(b) : false);

/** True when `path` is the Everyday folder. */
export const isEveryday = (path: string | null | undefined, everydayPath: string | null | undefined): boolean => samePlace(path, everydayPath);

/** The panes in the Everyday folder: one opened there, or one whose grid shows it. */
export const everydaySessions = (sessions: readonly FolderSession[], everydayPath: string | null | undefined): FolderSession[] =>
  everydayPath ? sessions.filter((s) => samePlace(s.cwd, everydayPath) || samePlace(s.view, everydayPath)) : [];

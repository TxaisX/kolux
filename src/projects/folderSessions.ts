// Txais (2026-11-12): the sidebar lists workspace folders only, never sessions or worktrees. The window still hands the
// panel its open agent and terminal panes, so a folder's removal question can say which of them still run there.
import type { AgentState } from "./rows";

export type FolderSession = { key: number; agent: string; title: string; cwd: string | null; view?: string | null; running: boolean; state?: AgentState; /** This pane draws the chat page; an untitled one is a chat nobody has typed into yet. */ chat?: boolean; untitled?: boolean; /** The kept Everyday chat this pane draws (projects/everydayChats.ts); one row per record. */ record?: string };

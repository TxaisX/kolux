// The window's open agent and terminal panes as the sidebar is handed them. Txais (2026-11-12, PR #255): the sidebar
// lists workspace folders only, with no session rows (every session is in the folder's grid); the panes still tell
// how many running sessions a sleep or a removal of a folder would close (ProjectsPanel runNote).
import type { AgentState } from "./rows";

export type FolderSession = { key: number; agent: string; title: string; cwd: string | null; view?: string | null; running: boolean; state?: AgentState };

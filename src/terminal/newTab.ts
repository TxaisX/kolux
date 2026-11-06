// What a new tab can run (TERM-040 / TERM-041, SESS-006): an installed shell, any installed agent,
// a chooser pane, the browser, a markdown file, or a file from disk. The layout strip no longer
// offers the New tab menu (owner change 2026-11-06); the keyboard shortcuts, a pane's own plus
// menu and the command line still open these here.
import type { AgentInfo } from "../launch/PlusMenu";

/** SESS-006: an installed shell, from `shell_list`; the first is the one Ctrl+T opens. */
export type ShellInfo = { id: string; name: string; program: string; args: string[] };

/** An agent, the default shell (null) or another one, the browser (BROW-001), a chooser pane or a
 * markdown file (SESS-006), or a file picked from disk (EDIT-001). */
export type NewTab = AgentInfo | null | { shell: ShellInfo } | "browser" | "file" | "diff" | "changes" | "chooser" | "markdown-new" | "markdown-open";

// The pane bodies that are only needed once a file, a note or a page is opened: the CodeMirror editor,
// the diff and all-changes views, the Markdown preview (Lexical and highlight.js behind it) and the
// browser page. A terminal pane, a tab and the pane's frame are drawn by the shell at once; the body
// arrives on first use (cycle 3, first load). Every name here is the module's own default export, so a
// caller swaps its import line and nothing else changes.
import { deferred } from "./deferred";

/** T-093-a: one file in CodeMirror. */
export const EditorPane = deferred(() => import("../editor/EditorPane"));

/** T-033 / EDIT-056: the diff view, and every change in the worktree beside it. */
export const DiffPane = deferred(() => import("../editor/DiffPane"));
export const AllChangesPane = deferred(() => import("../editor/AllChangesPane"));

/** T-093-b: the read-only Markdown preview, with its diagrams and highlighted code. */
export const PreviewPane = deferred(() => import("../editor/PreviewPane"));

/** T-012-a: a page in its own web view, laid over the pane body by the back end. */
export const BrowserPane = deferred(() => import("../browser/BrowserPane"));

/** The CI check tab: one pull request check with its log excerpt and Fix with AI. */
export const CheckPane = deferred(() => import("../scm/CheckPane"));

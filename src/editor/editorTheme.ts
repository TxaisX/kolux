// EDIT-006 / N-14 (audit): the editor's theme, on its own so the three panes that draw a read-only
// CodeMirror (the diff, All Changes' sections and the disk banner) do not import the 900-line
// EditorPane for one style. That import was the cycle the build warned about.
import { EditorView } from "@codemirror/view";

export const look = EditorView.theme({
  "&": { height: "100%", background: "var(--pane-bg)", color: "var(--fg)", fontSize: "13px" },
  // TERM-097 / SET-018: the editor font, which is the terminal font unless set on its own.
  ".cm-scroller": { fontFamily: "var(--editor-font, var(--mono-font))", lineHeight: "1.5" },
  ".cm-gutters": { background: "var(--pane-bg)", color: "var(--fg-faint)", border: "none" },
  // See-through, so the selection drawn under the text still shows on the caret's line.
  ".cm-activeLine, .cm-activeLineGutter": { background: "color-mix(in srgb, var(--row-selected) 45%, transparent)" },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection": { background: "color-mix(in srgb, var(--line-focus) 90%, transparent) !important" },
  "&.cm-focused": { outline: "none" },
  ".cm-cursor": { borderLeftColor: "var(--fg)" },
});
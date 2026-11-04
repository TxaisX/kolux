// C23-R3-01: one syntax highlight style for both modes. The ten inks are tokens (`--syn-*`), so the
// light palette's floored values reach the editor without a second style; the tag map is One Dark's
// own, read from the library so it cannot drift. The editor's `darkTheme` facet follows the mode
// through a compartment, which is what makes @codemirror/merge pick its `&light` diff marks instead
// of the `&dark` wash it was painting on a light ground.
import { HighlightStyle, syntaxHighlighting, type TagStyle } from "@codemirror/language";
import { oneDarkHighlightStyle } from "@codemirror/theme-one-dark";
import { Compartment, type Extension } from "@codemirror/state";
import { EditorView, ViewPlugin } from "@codemirror/view";
import { currentDark, TERMINAL_EVENT } from "../theme";

/** The One Dark hex each token replaces, so the style and the contrast test read one map. */
export const SYNTAX_INK: Record<string, string> = {
  "#c678dd": "keyword",
  "#e06c75": "name",
  "#61afef": "function",
  "#e5c07b": "type",
  "#d19a66": "number",
  "#56b6c2": "operator",
  "#7d8799": "comment",
  "#98c379": "string",
  "#abb2bf": "definition",
  "#ffffff": "invalid",
};

/** One Dark's tag map with every colour pointed at its token; weights and decorations unchanged. */
export const codeHighlight = HighlightStyle.define(
  oneDarkHighlightStyle.specs.map((s: TagStyle): TagStyle => {
    const name = s.color ? SYNTAX_INK[s.color.toLowerCase()] : undefined;
    return name ? { ...s, color: `var(--syn-${name}, ${s.color})` } : s;
  }),
);

export const codeHighlighting = syntaxHighlighting(codeHighlight);

/** The editor's dark/light facet, swapped when the appearance changes. */
const mode = new Compartment();

/** Keeps the facet in step with the app: `applyAppearance` fires TERMINAL_EVENT on every change. */
const followMode = ViewPlugin.fromClass(
  class {
    private readonly view: EditorView;
    private readonly onTheme = () => {
      this.view.dispatch({ effects: mode.reconfigure(EditorView.darkTheme.of(currentDark())) });
    };
    constructor(view: EditorView) {
      this.view = view;
      if (typeof window !== "undefined") window.addEventListener(TERMINAL_EVENT, this.onTheme);
    }
    destroy() {
      if (typeof window !== "undefined") window.removeEventListener(TERMINAL_EVENT, this.onTheme);
    }
  },
);

/** The mode extension for a new editor: the facet seeded with the mode in force, plus the listener. */
export const editorMode = (dark: boolean): Extension => [mode.of(EditorView.darkTheme.of(dark)), followMode];

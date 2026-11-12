// APP-014: which rows the right-click menu of a text field has. Pure; EditMenu.tsx draws them and
// EditMenuHost.tsx runs them.
import type { Platform } from "../keys/actions";

/** What the menu needs to know about the element under the pointer. */
export type FieldLike = {
  tag: string;
  /** The type of an input element. */
  type?: string;
  readOnly?: boolean;
  disabled?: boolean;
  contentEditable?: boolean;
  /** Inside a terminal pane, which has its own menu. */
  inTerminal?: boolean;
};

export type FieldKind = "none" | "editable" | "readonly" | "password";

const TEXT_TYPES = new Set(["", "text", "search", "url", "tel", "email", "number"]);

export function fieldKind(f: FieldLike | null): FieldKind {
  if (!f || f.inTerminal) return "none";
  const tag = f.tag.toLowerCase();
  if (tag === "textarea" || tag === "input") {
    const type = (f.type ?? "").toLowerCase();
    if (tag === "input" && type !== "password" && !TEXT_TYPES.has(type)) return "none";
    if (f.disabled) return "none";
    if (type === "password") return f.readOnly ? "none" : "password";
    return f.readOnly ? "readonly" : "editable";
  }
  return f.contentEditable ? "editable" : "none";
}

export type EditAction = { kind: "suggest"; word: string } | { kind: "cut" | "copy" | "paste" | "selectAll" };

export type EditItem = {
  id: string;
  name: string;
  /** The chord shown beside the name. */
  shortcut?: string;
  disabled: boolean;
  /** Rows of one group sit together; a rule is drawn between groups. */
  group: number;
  action: EditAction;
};

export type EditMenuInput = {
  kind: FieldKind;
  hasSelection: boolean;
  /** Text selected in ordinary, non-editable text (a preview, a chat message, a diff): Copy is all it can do. */
  plainSelection?: boolean;
  /** False only when the clipboard is known to hold no text; unknown keeps Paste usable. */
  clipboardHasText?: boolean;
  /** Spelling suggestions the platform supplied; they sit at the top. */
  suggestions?: string[];
  platform: Platform;
};

export const shortcutLabel = (letter: string, platform: Platform): string =>
  platform === "darwin" ? `\u2318${letter.toUpperCase()}` : `Ctrl+${letter.toUpperCase()}`;

export function editMenuItems(i: EditMenuInput): EditItem[] {
  // N-07: text selected in something that is not a field gets Copy and nothing else. Kolux hides the web
  // view's own menu, so without this row there is no way to copy from a preview, chat or a diff by mouse.
  if (i.kind === "none") return i.plainSelection && i.hasSelection ? [{ id: "copy", name: "Copy", shortcut: shortcutLabel("c", i.platform), disabled: false, group: 1, action: { kind: "copy" } }] : [];
  const out: EditItem[] = [];
  if (i.kind === "editable") {
    (i.suggestions ?? []).forEach((word, n) => out.push({ id: `suggest-${n}`, name: word, disabled: false, group: 0, action: { kind: "suggest", word } }));
  }
  const row = (id: "cut" | "copy" | "paste" | "selectAll", name: string, letter: string, disabled: boolean): void => {
    out.push({ id, name, shortcut: shortcutLabel(letter, i.platform), disabled, group: 1, action: { kind: id } });
  };
  const writable = i.kind === "editable" || i.kind === "password";
  if (writable && i.kind !== "password") row("cut", "Cut", "x", !i.hasSelection);
  if (i.kind !== "password") row("copy", "Copy", "c", !i.hasSelection);
  if (writable) row("paste", "Paste", "v", i.clipboardHasText === false);
  row("selectAll", "Select All", "a", false);
  return out;
}

// C01-R5-01: Edit > Paste in the focused text field. A page cannot run the browser's own paste
// command (it needs a user gesture the native menu click does not give the webview), so the menu
// reads the clipboard and inserts the text where the caret is, exactly as typing would: the
// selection is replaced, the caret ends after the new text, and one input event tells the field's
// owner (React, the settings forms) what changed. A contenteditable editor gets the engine's own
// insertText when it has one, so its undo history and input rules run.

/** The part of a text field this file uses (an input, a textarea, or a contenteditable host). */
export type FieldLike = {
  tagName: string;
  isContentEditable?: boolean;
  readOnly?: boolean;
  disabled?: boolean;
  value?: string;
  maxLength?: number;
  selectionStart?: number | null;
  selectionEnd?: number | null;
  setRangeText?: (text: string, start: number, end: number, mode: "end") => void;
  contains?: (node: Node | null) => boolean;
  dispatchEvent: (e: Event) => boolean;
};

const isTextField = (el: FieldLike) => el.tagName === "INPUT" || el.tagName === "TEXTAREA";

const inputEvent = (data: string): Event =>
  typeof InputEvent === "function"
    ? new InputEvent("input", { bubbles: true, inputType: "insertFromPaste", data })
    : new Event("input", { bubbles: true });

/** Text as a text field would take it: the selection replaced and the caret after it. */
export function insertPastedText(el: FieldLike, text: string): boolean {
  if (!text) return false;
  if (isTextField(el)) {
    if (el.readOnly || el.disabled) return false;
    const value = el.value ?? "";
    const start = el.selectionStart ?? value.length;
    const end = el.selectionEnd ?? start;
    let insert = text;
    const max = el.maxLength ?? -1;
    if (max >= 0) {
      const room = max - (value.length - (end - start));
      if (room <= 0) return false;
      insert = insert.slice(0, room);
    }
    try {
      el.setRangeText?.(insert, start, end, "end");
    } catch {
      // A number field has no selection API; append there instead of dropping the paste.
      el.value = value.slice(0, start) + insert + value.slice(end);
    }
    el.dispatchEvent(inputEvent(insert));
    return true;
  }
  if (!el.isContentEditable || typeof document === "undefined") return false;
  if (document.execCommand?.("insertText", false, text)) return true;
  const sel = window.getSelection?.();
  if (!sel || sel.rangeCount === 0 || !sel.anchorNode || !el.contains?.(sel.anchorNode)) return false;
  sel.deleteFromDocument();
  const range = sel.getRangeAt(0);
  const node = document.createTextNode(text);
  range.insertNode(node);
  range.setStartAfter(node);
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
  el.dispatchEvent(inputEvent(text));
  return true;
}

/** Read the clipboard, then paste into `el` only if it is still the focused element. */
export async function pasteIntoField(
  el: FieldLike | null,
  read: () => Promise<string>,
  refused: (error: unknown) => void = () => {},
  active: () => unknown = () => (typeof document === "undefined" ? null : document.activeElement),
): Promise<boolean> {
  if (!el) return false;
  let text: string;
  try {
    text = await read();
  } catch (e) {
    refused(e);
    return false;
  }
  if (active() !== el) return false;
  return insertPastedText(el, text);
}

/** The Edit menu's Paste: the clipboard read, the one thing to say if it is refused, and the paste. */
export function pasteFromMenu(el: FieldLike | null, say: (message: string) => void): Promise<boolean> {
  return pasteIntoField(el, () => navigator.clipboard.readText(), (e) =>
    say(`The clipboard could not be read (${e instanceof Error ? e.message : String(e)})`));
}

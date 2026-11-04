// C01-R5-01: Edit > Paste in the focused text field replaces the selection, keeps a textarea's
// line breaks, refuses a read-only field, respects maxLength, and never lands in a field that lost
// the focus while the clipboard was being read.
import { describe, expect, it } from "vitest";
import { insertPastedText, pasteIntoField, type FieldLike } from "./fieldPaste";

function field(over: Partial<FieldLike> = {}) {
  const events: Event[] = [];
  const f: FieldLike & { value: string } = {
    tagName: "INPUT",
    value: "hello world",
    maxLength: -1,
    selectionStart: 5,
    selectionEnd: 5,
    setRangeText(text, start, end) {
      this.value = this.value.slice(0, start) + text + this.value.slice(end);
      this.selectionStart = this.selectionEnd = start + text.length;
    },
    dispatchEvent: (e) => (events.push(e), true),
    ...over,
  };
  return { f, events };
}

describe("Edit > Paste in a text field", () => {
  it("puts the clipboard text at the caret and tells the field it changed", () => {
    const { f, events } = field();
    expect(insertPastedText(f, " big")).toBe(true);
    expect(f.value).toBe("hello big world");
    expect(f.selectionStart).toBe(9);
    expect(events.map((e) => e.type)).toEqual(["input"]);
    expect(events[0].bubbles).toBe(true);
  });

  it("replaces a selection, and an empty clipboard writes nothing", () => {
    const { f, events } = field({ selectionStart: 0, selectionEnd: 5 });
    expect(insertPastedText(f, "bye")).toBe(true);
    expect(f.value).toBe("bye world");
    expect(insertPastedText(f, "")).toBe(false);
    expect(events).toHaveLength(1);
  });

  it("keeps a textarea's line breaks, and a read-only or disabled field takes nothing", () => {
    const { f } = field({ tagName: "TEXTAREA", value: "a", selectionStart: 1, selectionEnd: 1 });
    expect(insertPastedText(f, "b\nc")).toBe(true);
    expect(f.value).toBe("ab\nc");
    const { f: ro, events } = field({ readOnly: true });
    expect(insertPastedText(ro, "x")).toBe(false);
    expect(events).toHaveLength(0);
    expect(insertPastedText(field({ disabled: true }).f, "x")).toBe(false);
  });

  it("stops at maxLength instead of dropping the whole paste", () => {
    const { f } = field({ value: "12345", maxLength: 8, selectionStart: 5, selectionEnd: 5 });
    expect(insertPastedText(f, "abcdef")).toBe(true);
    expect(f.value).toBe("12345abc");
    expect(insertPastedText(field({ value: "12345678", maxLength: 8, selectionStart: 8, selectionEnd: 8 }).f, "x")).toBe(false);
  });

  it("pastes only while the field is still the focused one", async () => {
    const { f, events } = field();
    expect(await pasteIntoField(f, async () => " big", () => {}, () => f)).toBe(true);
    expect(f.value).toBe("hello big world");
    const other = field();
    expect(await pasteIntoField(other.f, async () => "x", () => {}, () => f)).toBe(false);
    expect(other.f.value).toBe("hello world");
    expect(events).toHaveLength(1);
  });

  it("says why when the clipboard cannot be read, and does nothing without a field", async () => {
    const { f } = field();
    const said: unknown[] = [];
    expect(await pasteIntoField(f, async () => { throw new Error("denied"); }, (e) => said.push(e), () => f)).toBe(false);
    expect(String(said[0])).toContain("denied");
    expect(f.value).toBe("hello world");
    expect(await pasteIntoField(null, async () => "x")).toBe(false);
    expect(insertPastedText(field({ tagName: "DIV" }).f, "x")).toBe(false);
  });
});

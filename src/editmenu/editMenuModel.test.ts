import { describe, expect, it } from "vitest";
import { editMenuItems, fieldKind, shortcutLabel } from "./editMenuModel";

const ids = (kind: Parameters<typeof editMenuItems>[0]["kind"], extra: Partial<Parameters<typeof editMenuItems>[0]> = {}) =>
  editMenuItems({ kind, hasSelection: true, platform: "win32", ...extra }).map((r) => r.id);

describe("which element gets a menu", () => {
  it("text boxes, text areas and rich-text editors do", () => {
    expect(fieldKind({ tag: "INPUT", type: "text" })).toBe("editable");
    expect(fieldKind({ tag: "input" })).toBe("editable");
    expect(fieldKind({ tag: "TEXTAREA" })).toBe("editable");
    expect(fieldKind({ tag: "DIV", contentEditable: true })).toBe("editable");
  });
  it("plain text, checkboxes, disabled boxes and the terminal do not", () => {
    expect(fieldKind({ tag: "DIV" })).toBe("none");
    expect(fieldKind({ tag: "P" })).toBe("none");
    expect(fieldKind({ tag: "INPUT", type: "checkbox" })).toBe("none");
    expect(fieldKind({ tag: "INPUT", type: "text", disabled: true })).toBe("none");
    expect(fieldKind({ tag: "TEXTAREA", inTerminal: true })).toBe("none");
    expect(fieldKind(null)).toBe("none");
  });
  it("read-only and password boxes are told apart", () => {
    expect(fieldKind({ tag: "INPUT", type: "text", readOnly: true })).toBe("readonly");
    expect(fieldKind({ tag: "TEXTAREA", readOnly: true })).toBe("readonly");
    expect(fieldKind({ tag: "INPUT", type: "password" })).toBe("password");
  });
});

describe("rows of the menu", () => {
  it("an editable field has cut, copy, paste and select all", () => {
    expect(ids("editable")).toEqual(["cut", "copy", "paste", "selectAll"]);
  });
  it("a read-only field has no cut and no paste", () => {
    expect(ids("readonly")).toEqual(["copy", "selectAll"]);
  });
  it("a password field never offers cut or copy", () => {
    expect(ids("password")).toEqual(["paste", "selectAll"]);
  });
  it("outside text there is no menu at all", () => {
    expect(editMenuItems({ kind: "none", hasSelection: true, platform: "win32", suggestions: ["a"] })).toEqual([]);
  });
  it("N-07: text selected outside a field gets Copy and only Copy", () => {
    const rows = editMenuItems({ kind: "none", hasSelection: true, plainSelection: true, platform: "win32" });
    expect(rows.map((r) => r.id)).toEqual(["copy"]);
    expect(rows[0].action).toEqual({ kind: "copy" });
    expect(rows[0].shortcut).toBe("Ctrl+C");
    // No selection, no menu: there would be nothing to copy.
    expect(editMenuItems({ kind: "none", hasSelection: false, plainSelection: true, platform: "win32" })).toEqual([]);
  });
  it("cut and copy are greyed out with nothing selected", () => {
    const rows = editMenuItems({ kind: "editable", hasSelection: false, platform: "win32" });
    expect(rows.filter((r) => r.disabled).map((r) => r.id)).toEqual(["cut", "copy"]);
  });
  it("paste is greyed out only when the clipboard is known to be empty", () => {
    const paste = (clipboardHasText?: boolean) => editMenuItems({ kind: "editable", hasSelection: true, platform: "win32", clipboardHasText }).find((r) => r.id === "paste")?.disabled;
    expect(paste(false)).toBe(true);
    expect(paste(true)).toBe(false);
    expect(paste(undefined)).toBe(false);
  });
});

describe("spelling suggestions", () => {
  it("slot in at the top, above the edit rows, in their own group", () => {
    const rows = editMenuItems({ kind: "editable", hasSelection: true, platform: "win32", suggestions: ["hello", "hallo"] });
    expect(rows.map((r) => r.name).slice(0, 3)).toEqual(["hello", "hallo", "Cut"]);
    expect(rows[0].group).toBeLessThan(rows[2].group);
    expect(rows[0].action).toEqual({ kind: "suggest", word: "hello" });
  });
  it("are left out of read-only and password fields and when none are supplied", () => {
    expect(ids("readonly", { suggestions: ["x"] })).toEqual(["copy", "selectAll"]);
    expect(ids("password", { suggestions: ["x"] })).toEqual(["paste", "selectAll"]);
    expect(ids("editable", { suggestions: [] })).toEqual(["cut", "copy", "paste", "selectAll"]);
  });
});

describe("modifier labels", () => {
  it("use Ctrl+ on Windows and Linux and the command sign on a Mac", () => {
    expect(shortcutLabel("c", "win32")).toBe("Ctrl+C");
    expect(shortcutLabel("v", "linux")).toBe("Ctrl+V");
    expect(shortcutLabel("a", "darwin")).toBe("\u2318A");
    const mac = editMenuItems({ kind: "editable", hasSelection: true, platform: "darwin" });
    expect(mac.map((r) => r.shortcut)).toEqual(["\u2318X", "\u2318C", "\u2318V", "\u2318A"]);
  });
});

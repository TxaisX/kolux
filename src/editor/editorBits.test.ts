// Small behaviour fixes from the UX audit (lane D, ux6) that live in component files with no DOM to render them in.
import { describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));
vi.mock("./buffers", () => ({ textOf: () => "", diskOf: () => "" }));

import { nameKey } from "./NamePrompt";
import { COPY_FAILED, COPY_OK, sendThrew } from "./ReviewNotes";
import { whyDisabled } from "./TableControls";
import { lookingLine } from "./TemplatePicker";
import { trashUnusedNotes } from "./trashUnused";

describe("nameKey (the name box)", () => {
  it("Enter saves and Escape cancels", () => {
    expect(nameKey("Enter", false, false)).toBe("accept");
    expect(nameKey("Escape", false, false)).toBe("cancel");
  });
  it("Enter on the Cancel button does not save: the button's own press runs instead", () => {
    expect(nameKey("Enter", false, true)).toBeNull();
  });
  it("Enter and Escape while an input method is composing belong to it", () => {
    expect(nameKey("Enter", true, false)).toBeNull();
    expect(nameKey("Escape", true, false)).toBeNull();
  });
  it("other keys do nothing", () => expect(nameKey("a", false, false)).toBeNull());
});

describe("ReviewNotes wording", () => {
  it("the copy messages are the one pair the tray uses", () => {
    expect(COPY_OK).toMatch(/Copied/);
    expect(COPY_FAILED).toMatch(/select the text below/);
  });
  it("a send that throws says the notes are kept, with the reason", () => {
    expect(sendThrew(new Error("no pane"))).toBe("The notes were not sent, so they are kept: no pane");
    expect(sendThrew("x")).toContain("x");
  });
});

describe("TableControls whyDisabled", () => {
  it("explains a greyed row and says nothing for a live one", () => {
    expect(whyDisabled("Delete row", true)).toMatch(/header row/);
    expect(whyDisabled("Row above", true)).toBeTruthy();
    expect(whyDisabled("Delete row", false)).toBeUndefined();
  });
});

describe("TemplatePicker lookingLine", () => {
  it("shows only after a moment and only while the list is not up", () => {
    expect(lookingLine(false, false)).toBeNull();
    expect(lookingLine(true, false)).toMatch(/Looking/);
    expect(lookingLine(true, true)).toBeNull();
  });
});

describe("trashUnusedNotes", () => {
  const closing = [{ key: 1, kind: "editor", path: "C:/w/untitled.md", cwd: "C:/w" }];
  it("tells onFail when the trash fails, and logs when nobody listens", async () => {
    invoke.mockRejectedValue(new Error("locked"));
    const fail = vi.fn();
    trashUnusedNotes(closing, [], fail);
    await new Promise((r) => setTimeout(r, 0));
    expect(fail).toHaveBeenCalledTimes(1);
    expect(fail.mock.calls[0][0]).toContain("locked");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    trashUnusedNotes(closing, []);
    await new Promise((r) => setTimeout(r, 0));
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});

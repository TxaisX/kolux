import { describe, expect, it } from "vitest";
import { bodyView, focusLost, peekDraft, stashDraft } from "./dialogState";

describe("UX audit: the task dialog", () => {
  it("a failed read is not 'Loading…' for ever", () => {
    expect(bodyView(null, null)).toBe("loading");
    expect(bodyView(null, "gh could not reach github.com")).toBe("failed");
    expect(bodyView({ body: "x" }, "a later refresh failed")).toBe("ready");
  });

  it("an unsaved description survives closing the dialog and is dropped once saved or put back", () => {
    stashDraft("u/1", "my words", "old words");
    expect(peekDraft("u/1")).toBe("my words");
    expect(peekDraft("u/2")).toBeNull();
    stashDraft("u/1", null, "old words"); // saved or cancelled: nothing to keep
    expect(peekDraft("u/1")).toBeNull();
    stashDraft("u/1", "same", "same"); // opened Edit and changed nothing
    expect(peekDraft("u/1")).toBeNull();
  });

  it("focus is lost only when it fell to nothing, not when something else took it", () => {
    const body = {};
    expect(focusLost(null, body)).toBe(true);
    expect(focusLost(body, body)).toBe(true);
    expect(focusLost({}, body)).toBe(false); // e.g. the palette opened over the dialog
  });
});

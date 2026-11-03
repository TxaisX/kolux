import { describe, expect, it } from "vitest";
import { defaultsOnly, resolve } from "../keys/keymap";
import { withChord } from "./tips";

describe("toolbar tooltips read the keymap", () => {
  const map = defaultsOnly("win32");
  it("names the default chord", () => {
    expect(withChord("Reload", map, "browser.reload")).toBe("Reload (Ctrl+R)");
    expect(withChord("Close tab", map, "tab.close")).toBe("Close tab (Ctrl+W)");
  });
  it("shows a customised chord and drops an unbound one", () => {
    const custom = resolve({ "browser.reload": "Ctrl+Shift+F5", "tab.close": [] } as never, "win32");
    expect(withChord("Reload", custom, "browser.reload")).toContain("F5");
    expect(withChord("Close tab", custom, "tab.close")).toBe("Close tab");
  });
});

import { closeWarning } from "./tips";
describe("closing a tab with work in it", () => {
  it("says nothing when nothing is at stake", () => expect(closeWarning(false, 0)).toBeNull());
  it("names the running download and the unsent notes", () => {
    expect(closeWarning(true, 0)).toContain("a download still running");
    expect(closeWarning(false, 1)).toContain("1 note not sent");
    expect(closeWarning(true, 3)).toContain("a download still running and 3 notes not sent");
  });
});

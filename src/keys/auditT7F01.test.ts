// AUD-T7 F01: a custom binding that lists the same chord twice is one binding, not two that clash.
// dropConflicts counts list entries, so the duplicate makes the binding clash with itself: it is
// dropped, the default comes back, and the Shortcuts page is told the command conflicts with itself.
import { describe, expect, test } from "vitest";
import { chordsOf, resolve } from "./keymap";

describe("resolve with a repeated custom chord", () => {
  test("[T7-F01] one binding listing a chord twice is not a clash", () => {
    const map = resolve({ keybindings: { "app.forceReload": ["Ctrl+Shift+U", "Ctrl+Shift+U"] } }, "win32");
    expect(chordsOf(map, "app.forceReload")).toContain("Ctrl+Shift+U");
    expect(map.bindings.get("app.forceReload")?.custom).toBe(true);
    expect(map.bindings.get("app.forceReload")?.dropped).toBeUndefined();
    expect(map.clashes).toEqual([]);
    expect(map.errors.join(" ")).not.toContain("clash");
  });
});

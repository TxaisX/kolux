// AUD-T7 F02: the Shortcuts recorder accepts Ctrl+0 for a digit-index command, but normaliseIndexChord
// rewrites only digits 1-9. The saved chord ends in 0; chordMatches reads an index only from a chord
// ending in 1, so Ctrl+0 fires with no index and does nothing, and yieldToUser also takes Ctrl+0 from
// Reset Zoom. The recorder's own comment says another digit is rewritten to 1.
import { describe, expect, test } from "vitest";
import { chordsOf, matchEvent, resolve, type KeyLike } from "./keymap";
import { recordKey } from "./record";

const key = (k: Partial<KeyLike>): KeyLike => ({ key: "", code: "", ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...k });

describe("recordKey on an index command", () => {
  test("[T7-F02] Ctrl+0 becomes the index chord and still switches workspaces", () => {
    const rec = recordKey(key({ code: "Digit0", key: "0", ctrlKey: true }), "win32", "workspace.selectByIndex");
    expect(rec).toEqual({ chord: "Mod+1" });
    const chord = rec && "chord" in rec ? rec.chord : "";
    const map = resolve({ keybindings: { "workspace.selectByIndex": chord } }, "win32");
    expect(chordsOf(map, "zoom.reset")).toEqual(["Mod+0"]);
    expect(matchEvent(map, key({ code: "Digit3", key: "3", ctrlKey: true }), ["global"])).toEqual({ id: "workspace.selectByIndex", index: 3 });
  });
});

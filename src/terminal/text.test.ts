import { describe, expect, it } from "vitest";
import { clampNumber, FIELDS, optionsOf, readText } from "./text";

describe("terminal text settings (SET-022 / SET-025)", () => {
  it("starts at 13 point, line height 1, a blinking block and 1000 rows of history", () => {
    const t = readText({}, false);
    expect([t.size, t.lineHeight, t.cursor, t.blink, t.scrollback, t.copyOnSelect]).toEqual([13, 1, "block", true, 1000, false]);
    expect(optionsOf(t).fontFamily).toContain("Cascadia Mono");
  });
  it("corrects bad and out-of-range values instead of keeping them", () => {
    const t = readText({ [FIELDS.size]: 99, [FIELDS.lineHeight]: "abc", [FIELDS.scrollback]: -5, [FIELDS.cursor]: "box", [FIELDS.weight]: "heavy" }, false);
    expect([t.size, t.lineHeight, t.scrollback, t.cursor, t.weight]).toEqual([32, 1, 0, "block", "normal"]);
    expect(readText({ [FIELDS.size]: 9 }).size).toBe(9);
    expect(readText({ [FIELDS.size]: 7 }).size).toBe(8);
    expect(clampNumber("1.234", 1, 2, 1, 0.05)).toBe(1.25);
  });
  it("converts an older scrollback saved as text to rows", () => {
    expect(readText({ [FIELDS.scrollback]: "5000" }).scrollback).toBe(5000);
  });
  it("pastes on right-click by default on Windows only (it goes through the paste guards, council D2 MERGE 47 FB2), and a saved choice wins", () => {
    expect(readText({}, true).rightClickPaste).toBe(true);
    expect(readText({ [FIELDS.rightClickPaste]: true }, true).rightClickPaste).toBe(true);
    expect(readText({}, false).rightClickPaste).toBe(false);
    expect(readText({ [FIELDS.rightClickPaste]: false }, true).rightClickPaste).toBe(false);
  });
  it("puts the chosen family in front of the built-in one and turns contrast into a ratio", () => {
    const o = optionsOf(readText({ [FIELDS.family]: "JetBrains Mono", [FIELDS.contrast]: true, [FIELDS.cursor]: "bar", [FIELDS.blink]: false }));
    expect(o.fontFamily?.startsWith('"JetBrains Mono"')).toBe(true);
    expect([o.minimumContrastRatio, o.cursorStyle, o.cursorBlink]).toEqual([4.5, "bar", false]);
  });
  it("term-102 lifts low-contrast text only when asked; the default is off because it is costly", () => {
    expect(optionsOf(readText({})).minimumContrastRatio).toBe(1);
    expect(optionsOf(readText({ [FIELDS.contrast]: true })).minimumContrastRatio).toBe(4.5);
    expect(optionsOf(readText({ [FIELDS.contrast]: false })).minimumContrastRatio).toBe(1);
  });
});

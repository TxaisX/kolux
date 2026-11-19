// after-list row (install trial): a user's own chord wins over a built-in default (both rows then clash, DT-C48); only user-vs-user clashes drop.
import { expect, test } from "vitest";
import { chordsOf, matchEvent, resolve, type KeyLike } from "./keymap";

const key = (k: Partial<KeyLike>): KeyLike => ({ key: "", code: "", ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...k });

test("a user chord that a built-in default also holds is kept and the default gives it up", () => {
  const map = resolve({ keybindings: { "sidebar.checks.toggle": "Mod+B" } }, "win32");
  expect(chordsOf(map, "sidebar.checks.toggle")).toEqual(["Mod+B"]);
  expect(chordsOf(map, "sidebar.left.toggle")).toEqual([]);
  expect(map.bindings.get("sidebar.checks.toggle")?.dropped).toBeUndefined();
  expect(map.clashes).toEqual([{ chord: "Mod+B", ids: ["sidebar.checks.toggle", "sidebar.left.toggle"] }]); // DT-C48: the default row shows Conflicts too
  expect(map.errors).toEqual([]);
  expect(map.warnings.join(" ")).toContain("Mod+B");
  expect(matchEvent(map, key({ key: "b", code: "KeyB", ctrlKey: true }), ["global"])?.id).toBe("sidebar.checks.toggle");
});

test("two user chords on one chord in one place are still both dropped, their defaults stay", () => {
  const map = resolve({ keybindings: { "sidebar.right.toggle": "Mod+Alt+Q", "sidebar.left.toggle": "Mod+Alt+Q" } }, "win32");
  expect(chordsOf(map, "sidebar.right.toggle")).toEqual(["Mod+L"]);
  expect(chordsOf(map, "sidebar.left.toggle")).toEqual(["Mod+B"]);
  expect(map.clashes).toEqual([{ chord: "Mod+Alt+Q", ids: ["sidebar.left.toggle", "sidebar.right.toggle"] }]);
  expect(map.errors.length).toBe(1);
});

test("a user chord on a default of another scope takes nothing from it", () => {
  const map = resolve({ keybindings: { "terminal.closePane": "Mod+W" } }, "win32");
  expect(map.errors).toEqual([]);
  expect(map.warnings).toEqual([]);
  expect(chordsOf(map, "terminal.closePane")).toEqual(["Mod+W"]);
  expect(chordsOf(map, "tab.close")).toEqual(["Mod+W"]);
});

test("an agent switched off never takes a chord from a default", () => {
  const file = { keybindings: { "tab.newAgent.aider": "Mod+T" } };
  const off = resolve(file, "win32", ["tab.newAgent.aider"]);
  expect(chordsOf(off, "tab.newTerminal")).toEqual(["Mod+T"]);
  expect(off.warnings).toEqual([]);
  const on = resolve(file, "win32");
  expect(chordsOf(on, "tab.newAgent.aider")).toEqual(["Mod+T"]);
  expect(chordsOf(on, "tab.newTerminal")).toEqual([]);
});

test("a user chord that clears a default of its own (null) takes nothing from anyone", () => {
  const map = resolve({ keybindings: { "sidebar.left.toggle": null, "sidebar.checks.toggle": "Mod+B" } }, "win32");
  expect(chordsOf(map, "sidebar.checks.toggle")).toEqual(["Mod+B"]);
  expect(chordsOf(map, "sidebar.left.toggle")).toEqual([]);
  expect(map.warnings).toEqual([]);
});

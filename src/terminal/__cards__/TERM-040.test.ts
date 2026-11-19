// TERM-040 chords: the new terminal tab (the markdown tabs went with the editor) (box 1's key half; the shell half is in cards_03.rs).
import { expect, test } from "vitest";
import { chordsOf, matchEvent, resolve } from "../../keys/keymap";

test("Cmd/Ctrl+T is the new terminal tab", () => {
  for (const p of ["win32", "linux", "darwin"] as const) {
    const map = resolve(null, p);
    expect(chordsOf(map, "tab.newTerminal")).toEqual(["Mod+T"]);
  }
  const key = { key: "t", code: "KeyT", altKey: false, shiftKey: false };
  expect(matchEvent(resolve(null, "win32"), { ...key, ctrlKey: true, metaKey: false }, ["tabs"])).toEqual({ id: "tab.newTerminal" });
  expect(matchEvent(resolve(null, "darwin"), { ...key, ctrlKey: false, metaKey: true }, ["tabs"])).toEqual({ id: "tab.newTerminal" });
});

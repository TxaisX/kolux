// TERM-040 chords: new terminal, markdown and open-markdown tabs (box 1's key half; the shell half is in cards_03.rs).
import { expect, test } from "vitest";
import { chordsOf, matchEvent, resolve } from "../../keys/keymap";

test("Cmd/Ctrl+T is the new terminal tab, Shift+M new markdown, Shift+O open markdown", () => {
  for (const p of ["win32", "linux", "darwin"] as const) {
    const map = resolve(null, p);
    expect(chordsOf(map, "tab.newTerminal")).toEqual(["Mod+T"]);
    expect(chordsOf(map, "tab.newMarkdown")).toEqual(["Mod+Shift+M"]);
    expect(chordsOf(map, "tab.openMarkdown")).toEqual(["Mod+Shift+O"]);
  }
  const key = { key: "t", code: "KeyT", altKey: false, shiftKey: false };
  expect(matchEvent(resolve(null, "win32"), { ...key, ctrlKey: true, metaKey: false }, ["tabs"])).toEqual({ id: "tab.newTerminal" });
  expect(matchEvent(resolve(null, "darwin"), { ...key, ctrlKey: false, metaKey: true }, ["tabs"])).toEqual({ id: "tab.newTerminal" });
});

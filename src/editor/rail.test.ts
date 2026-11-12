import { expect, test } from "vitest";
import { anchorIndex, placeRail, railEdit, railItems, railNotes } from "./rail";
import type { Note } from "./notes";

const note = (path: string, line: number, time: number, quote = "q"): Note => ({ path, line, time, quote, note: "n" });

test("EDIT-020 (T-132-b): the rail lists only this file's notes, by source line then time, whatever the slash or case", () => {
  const all = [note("C:\\w\\a.md", 9, 1), note("c:/w/A.md", 2, 5), note("C:\\w\\b.md", 1, 1), note("C:\\w\\a.md", 2, 3)];
  expect(railNotes(all, "C:/w/a.md").map((n) => [n.line, n.time])).toEqual([[2, 3], [2, 5], [9, 1]]);
  expect(railNotes([], "C:/w/a.md")).toEqual([]);
});

test("N-11: a note made through one WSL share name sits beside the file opened through the other", () => {
  const all = [note("\\\\wsl$\\Ubuntu\\home\\x\\a.md", 4, 1), note("\\\\wsl$\\Ubuntu\\home\\x\\A.md", 5, 2), note("\\\\wsl$\\Ubuntu\\home\\y\\a.md", 6, 3)];
  // Either share name, either slash kind, either distro case: one file.
  expect(railNotes(all, "\\\\wsl.localhost\\ubuntu\\home\\x\\a.md").map((n) => n.line)).toEqual([4]);
  // Linux keeps its letter case, so a.md and A.md stay two files (as Linux does).
  expect(railNotes(all, "\\\\wsl$\\Ubuntu\\home\\x\\A.md").map((n) => n.line)).toEqual([5]);
  // A file that reaches a Windows drive through the distribution's /mnt is that drive's file.
  expect(railNotes([note("\\\\wsl$\\Ubuntu\\mnt\\c\\w\\a.md", 7, 1)], "C:\\w\\a.md").map((n) => n.line)).toEqual([7]);
});

test("EDIT-020 (T-132-b): cards sit beside their text, and ones that would overlap are pushed down in order", () => {
  const out = placeRail([
    { id: "a", top: 100, height: 50 },
    { id: "b", top: 120, height: 50 }, // would overlap a
    { id: "c", top: 400, height: 50 }, // far enough to keep its place
    { id: "d", top: 410, height: 50 },
  ]);
  expect(out).toEqual({ a: 100, b: 156, c: 400, d: 456 });
  expect(placeRail([])).toEqual({});
});

test("EDIT-020 (T-132-b): a note whose text is gone sits below the last placed card, not at the top", () => {
  const items = railItems([note("p", 1, 1), note("p", 2, 2), note("p", 3, 3)], [200, null, 500], 50);
  expect(items.map((i) => i.top)).toEqual([200, 200, 500]);
  expect(Object.values(placeRail(items))).toEqual([200, 256, 500]);
});

test("EDIT-020 (T-132-b): a quote is found by its first line, or its first three words when the markup changed the rest", () => {
  const texts = ["Title", "Some words here.", "more"];
  expect(anchorIndex(texts, "\n  Some words here.\nmore")).toBe(1);
  expect(anchorIndex(texts, "Some words here and then more")).toBe(1);
  expect(anchorIndex(texts, "absent text")).toBe(-1);
  expect(anchorIndex(texts, "   ")).toBe(-1);
});

test("EDIT-020 (row 137): a card as tall as its text pushes the next one down by its own height", () => {
  const items = railItems([note("p", 1, 1), note("p", 2, 2)], [100, 110], [140, 58]);
  expect(items.map((i) => i.height)).toEqual([140, 58]);
  expect(placeRail(items)).toEqual({ "1:0": 100, "2:1": 246 });
  expect(railItems([note("p", 1, 1)], [0], 58)[0].height).toBe(58); // one height for every card still works
});

test("EDIT-020 (row 137): leaving a card's edit saves trimmed text, ignores no change and refuses an empty note", () => {
  expect(railEdit("  fix this  \n", "old")).toEqual({ save: "fix this" });
  expect(railEdit("old ", "old")).toEqual({ same: true });
  expect(railEdit("   \n", "old")).toEqual({ refused: true });
});

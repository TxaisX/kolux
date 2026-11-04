import { describe, expect, it } from "vitest";
import { between, claimRead, dirAt, DRAFT, expandNote, flatten, isWsl, movesInto, redoOf, tops, undoOf, type Node } from "./Explorer";

const dir = (path: string): Node => ({ name: path.split("/").pop()!, path, kind: "dir" });
const file = (path: string): Node => ({ name: path.split("/").pop()!, path, kind: "file" });
const kids = { "/r": [dir("/r/a"), dir("/r/b"), file("/r/c.ts")], "/r/a": [file("/r/a/x.ts")], "/r/b": [file("/r/b/y.ts"), file("/r/b/z.ts")] };

describe("explorer rows", () => {
  it("shows only the children of open folders, depth first, each knowing its parent", () => {
    expect(flatten("/r", kids, new Set()).map((r) => r.node.path)).toEqual(["/r/a", "/r/b", "/r/c.ts"]);
    const rows = flatten("/r", kids, new Set(["/r/b"]));
    expect(rows.map((r) => [r.node.path, r.depth, r.parent])).toEqual([
      ["/r/a", 0, null],
      ["/r/b", 0, null],
      ["/r/b/y.ts", 1, "/r/b"],
      ["/r/b/z.ts", 1, "/r/b"],
      ["/r/c.ts", 0, null],
    ]);
  });
  it("keeps an open folder whose children have not loaded yet as a plain row", () => {
    expect(flatten("/r", { "/r": kids["/r"] }, new Set(["/r/a"])).length).toBe(3);
  });
  it("selects a range from either end", () => {
    const rows = flatten("/r", kids, new Set(["/r/b"]));
    expect(between(rows, 1, 3)).toEqual(["/r/b", "/r/b/y.ts", "/r/b/z.ts"]);
    expect(between(rows, 3, 1)).toEqual(between(rows, 1, 3));
  });
});

describe("explorer file operations", () => {
  it("puts the new-name row first in its folder", () => {
    const rows = flatten("/r", kids, new Set(["/r/b"]), { dir: "/r/b", folder: false });
    expect(rows.map((r) => r.node.path)).toEqual(["/r/a", "/r/b", DRAFT, "/r/b/y.ts", "/r/b/z.ts", "/r/c.ts"]);
    expect(rows[2].depth).toBe(1);
  });
  it("deletes a folder chosen with its own children once, as the folder", () => {
    expect(tops(["/r/b", "/r/b/y.ts", "/r/c.ts", "/r/bb"])).toEqual(["/r/b", "/r/c.ts", "/r/bb"]);
  });
  it("undoes and redoes each action with its opposite", () => {
    expect(undoOf({ kind: "create", path: "/r/n.ts" })).toEqual(["fs_trash", { paths: ["/r/n.ts"], expect: [null] }]);
    expect(redoOf({ kind: "create", path: "/r/n.ts" })).toEqual(["fs_restore", { paths: ["/r/n.ts"] }]);
    expect(undoOf({ kind: "rename", from: "C:\\r\\a.ts", to: "C:\\r\\b.ts" })).toEqual(["fs_rename", { path: "C:\\r\\b.ts", name: "a.ts", expect: null }]);
    expect(redoOf({ kind: "rename", from: "/r/a.ts", to: "/r/b.ts" })).toEqual(["fs_rename", { path: "/r/a.ts", name: "b.ts", expect: null }]);
    expect(undoOf({ kind: "trash", paths: ["/r/a", "/r/c.ts"] })).toEqual(["fs_restore", { paths: ["/r/a", "/r/c.ts"] }]);
    expect(redoOf({ kind: "trash", paths: ["/r/a"] })).toEqual(["fs_trash", { paths: ["/r/a"] }]);
  });
  it("hands back the identity it recorded, so an undo never acts on a later file at the same path", () => {
    // C24-R3-01: a New file undone after an agent wrote its own file at that path.
    expect(undoOf({ kind: "create", path: "/r/notes.md", id: "7c:1f" })).toEqual(["fs_trash", { paths: ["/r/notes.md"], expect: ["7c:1f"] }]);
    // A rename undone after `b.ts` was replaced: the entry that was renamed is no longer there.
    expect(undoOf({ kind: "rename", from: "C:\\r\\a.ts", to: "C:\\r\\b.ts", id: "7c:20" })).toEqual([
      "fs_rename",
      { path: "C:\\r\\b.ts", name: "a.ts", expect: "7c:20" },
    ]);
    // A rename keeps the entry, so a redo checks the same identity at the name it now holds.
    expect(redoOf({ kind: "rename", from: "/r/a.ts", to: "/r/b.ts", id: "7c:20" })).toEqual(["fs_rename", { path: "/r/a.ts", name: "b.ts", expect: "7c:20" }]);
    // A copy's undo names each copy's own entry.
    const copy = { kind: "copy" as const, from: ["/r/a.ts", "/r/b.ts"], dir: "/r/d", made: ["/r/d/a.ts", "/r/d/b.ts"], ids: ["7c:30", "7c:31"] };
    expect(undoOf(copy)).toEqual(["fs_trash", { paths: ["/r/d/a.ts", "/r/d/b.ts"], expect: ["7c:30", "7c:31"] }]);
    // An action recorded before identities existed still undoes: it simply has nothing to check.
    expect(undoOf({ kind: "copy", from: ["/r/a.ts"], dir: "/r/d", made: ["/r/d/a.ts"] })).toEqual(["fs_trash", { paths: ["/r/d/a.ts"], expect: [null] }]);
  });
  it("knows a WSL share, where a delete is for good", () => {
    expect(isWsl("\\\\wsl$\\Ubuntu\\home\\a")).toBe(true);
    expect(isWsl("\\\\wsl.localhost\\Ubuntu\\x")).toBe(true);
    expect(isWsl("//wsl.localhost/Ubuntu/x")).toBe(true);
    expect(isWsl("C:\\wsl$\\x")).toBe(false);
  });
  it("undoes a copy by binning the copies and a move by moving each item back", () => {
    const copy = { kind: "copy" as const, from: ["/r/a.ts"], dir: "/r/d", made: ["/r/d/a.ts"] };
    expect(undoOf(copy)).toEqual(["fs_trash", { paths: ["/r/d/a.ts"], expect: [null] }]);
    expect(redoOf(copy)).toEqual(["fs_copy", { paths: ["/r/a.ts"], dir: "/r/d" }]);
    const move = { kind: "move" as const, moves: [["/r/a.ts", "/r/d/a.ts"], ["/r/x/b", "/r/d/b"]] as [string, string][] };
    expect(undoOf(move)).toEqual(["fs_move", { moves: [["/r/d/a.ts", "/r"], ["/r/d/b", "/r/x"]] }]);
    expect(redoOf(move)).toEqual(["fs_move", { moves: [["/r/a.ts", "/r/d"], ["/r/x/b", "/r/d"]] }]);
  });
  it("drops into the folder under the pointer, the folder holding a file, or the root", () => {
    const kids = { "/r": [{ name: "d", path: "/r/d", kind: "dir" }, { name: "f.ts", path: "/r/f.ts", kind: "file" }] as Node[], "/r/d": [{ name: "g.ts", path: "/r/d/g.ts", kind: "file" }] as Node[] };
    const rows = flatten("/r", kids, new Set(["/r/d"]));
    const isDir = (n: Node) => n.kind === "dir";
    expect([0, 1, 2, 9].map((i) => dirAt(rows, i, "/r", isDir))).toEqual(["/r/d", "/r/d", "/r", "/r"]);
  });
  it("moves a folder chosen with its own children once, and skips what is already there", () => {
    expect(movesInto(["/r/d", "/r/d/g.ts", "/r/f.ts", "/r/e/h.ts"], "/r/e")).toEqual([["/r/d", "/r/e"], ["/r/f.ts", "/r/e"]]);
    expect(movesInto(["/r/e"], "/r/e")).toEqual([]);
  });
});

describe("explorer live reads and Expand all", () => {
  it("lets the live poll skip a folder whose read is still out, but never an asked-for read", () => {
    const out = new Set<string>();
    expect(claimRead(out, "/r", true)).toBe(true);
    expect(claimRead(out, "/r", true)).toBe(false);
    expect(claimRead(out, "/r", false)).toBe(true);
    out.delete("/r");
    expect(claimRead(out, "/r", true)).toBe(true);
  });
  it("says nothing when Expand all finished cleanly, and names the cap and the folders it could not read", () => {
    expect(expandNote(false, 0)).toBeNull();
    expect(expandNote(true, 0)).toMatch(/stopped at 300 folders/);
    expect(expandNote(false, 1)).toMatch(/1 folder could not be read/);
    expect(expandNote(true, 2)).toMatch(/300 folders.*2 folders could not be read/);
  });
});

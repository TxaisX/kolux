import { describe, expect, it } from "vitest";
import { closeAction } from "./AddProject";
import { directionLabel, tickRows, type ScanRow } from "./cleanup";
import { PROJECT_COMMANDS, PROJECT_COMMAND_EVENT, isProjectCommand, runProjectCommand } from "./commands";
import { restoreField } from "./draft";
import { menuGaps, menuMove } from "./menu";
import { stepRow } from "./order";
import { closingNote, rowKey, runningUnder, sleepPlan } from "./rows";
import { begin, scanToStop } from "./scanView";

describe("row keys: only the row answers", () => {
  it("Enter, Space and F2 on the row; the same keys inside a button on it do nothing", () => {
    expect(rowKey("Enter", true)).toBe("show");
    expect(rowKey(" ", true)).toBe("show");
    expect(rowKey("F2", true)).toBe("rename");
    expect(rowKey("Enter", false)).toBeNull();
    expect(rowKey("F2", false)).toBeNull();
    expect(rowKey("a", true)).toBeNull();
  });
});

describe("menu keyboard and gaps", () => {
  it("arrows wrap, Home and End jump, other keys are left alone", () => {
    expect(menuMove("ArrowDown", 2, 3)).toBe(0);
    expect(menuMove("ArrowUp", 0, 3)).toBe(2);
    expect(menuMove("ArrowDown", -1, 3)).toBe(0);
    expect(menuMove("Home", 2, 3)).toBe(0);
    expect(menuMove("End", 0, 3)).toBe(2);
    expect(menuMove("x", 0, 3)).toBeNull();
    expect(menuMove("ArrowDown", 0, 0)).toBeNull();
  });
  it("says what the menu is missing, and nothing when all loaded", () => {
    expect(menuGaps({})).toBeNull();
    expect(menuGaps({ statuses: true })).toContain("Move to status");
    expect(menuGaps({ statuses: true, editors: true })).toContain(" and ");
  });
});

describe("move up and down", () => {
  it("swaps with the neighbour and stops at the ends", () => {
    expect(stepRow(["a", "b", "c"], "b", -1)).toEqual(["b", "a", "c"]);
    expect(stepRow(["a", "b", "c"], "b", 1)).toEqual(["a", "c", "b"]);
    expect(stepRow(["a", "b"], "a", -1)).toEqual(["a", "b"]);
    expect(stepRow(["a", "b"], "z", 1)).toEqual(["a", "b"]);
  });
});

describe("sleeping and the running terminals it closes", () => {
  it("counts terminals in or under the folders, case and slash blind", () => {
    const bs = String.fromCharCode(92); // a Windows spelling of the folder
    expect(runningUnder(["C:" + bs + "w" + bs + "ws" + bs + "fix"], ["c:/w/ws/fix/src", "C:/w/ws/fixer", "C:/other"])).toBe(1);
    expect(runningUnder([], ["C:/a"])).toBe(0);
  });
  it("words the note by count and is empty for none", () => {
    expect(closingNote(0)).toBe("");
    expect(closingNote(1)).toBe(" 1 terminal is still running and will be closed.");
    expect(closingNote(2)).toBe(" 2 terminals are still running and will be closed.");
  });
  it("a parent puts its children to sleep and the plan lists only the folders that change", () => {
    const ws = [{ path: "C:/w/a" }, { path: "C:/w/b", parent: "C:/w/a" }];
    const plan = sleepPlan([], ws, "C:/w/a");
    expect(plan.paths.sort()).toEqual(["C:/w/a", "C:/w/b"]);
    expect(sleepPlan(plan.next, ws, "C:/w/a").paths).toEqual([]);
  });
});

describe("a failed create keeps what was typed", () => {
  it("restores only into an empty field", () => {
    expect(restoreField("", "fix-login")).toBe("fix-login");
    expect(restoreField("new", "fix-login")).toBe("new");
  });
});

describe("cleanup dialog words and ticking", () => {
  const row = (path: string): ScanRow => ({ path, branch: null, name: null, idleDays: null, changes: 0, merged: false, unmerged: false } as ScanRow);
  it("names the direction for the key being sorted", () => {
    expect(directionLabel("size", true)).toBe("Largest first");
    expect(directionLabel("size", false)).toBe("Smallest first");
    expect(directionLabel("name", true)).toBe("Z to A");
    expect(directionLabel("idle", true)).toBe("Idle longest first");
  });
  it("tick all and untick all touch the listed rows only", () => {
    const on = tickRows({ x: false, z: true }, [row("x"), row("y")], true);
    expect(on).toEqual({ x: true, y: true, z: true });
    expect(tickRows(on, [row("x")], false)).toEqual({ x: false, y: true, z: true });
  });
});

describe("closing the Add project dialog", () => {
  it("closes at once unless a clone is under way, then asks, then keeps copying", () => {
    expect(closeAction(false, "", false)).toBe("close");
    expect(closeAction(true, "create", false)).toBe("close");
    expect(closeAction(true, "t1", false)).toBe("ask");
    expect(closeAction(true, "t1", true)).toBe("keep");
  });
});

describe("leaving the scan dialog stops a scan still running", () => {
  it("names the scan to stop only while it runs", () => {
    expect(scanToStop(null)).toBeNull();
    const s = begin(7);
    expect(scanToStop(s)).toBe(7);
    expect(scanToStop({ ...s, running: false })).toBeNull();
  });
});

describe("palette rows for the sidebar", () => {
  it("lists Add project, New group and Scan for repos, and tells the panel through one event", () => {
    expect(PROJECT_COMMANDS.map((c) => c.label)).toEqual(["Add project", "New group", "Scan for repos"]);
    expect(isProjectCommand("project.scan")).toBe(true);
    expect(isProjectCommand("nope")).toBe(false);
    const seen: unknown[] = [];
    runProjectCommand("project.add", { dispatchEvent: (e: Event) => (seen.push([e.type, (e as CustomEvent).detail]), true) });
    expect(seen).toEqual([[PROJECT_COMMAND_EVENT, "project.add"]]);
  });
});

import { addReport } from "./rows";
describe("adding several folders at once", () => {
  it("asks about the first plain folder and counts the rest and the failures in one note", () => {
    const r = addReport([
      { path: "a", kind: "added" },
      { path: "b", kind: "plain" },
      { path: "c", kind: "plain" },
      { path: "d", kind: "failed", error: "no such folder" },
    ]);
    expect(r.ask).toBe("b");
    expect(r.kind).toBe("error");
    expect(r.note).toContain("1 project added.");
    expect(r.note).toContain("1 more folder is not Git repositories");
    expect(r.note).toContain("d: no such folder");
  });
  it("says nothing extra for a single plain folder", () => {
    const r = addReport([{ path: "b", kind: "plain" }]);
    expect(r).toEqual({ ask: "b", note: null, kind: "ok" });
  });
});

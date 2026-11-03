import { describe, expect, it } from "vitest";
import type { SpaceRow } from "../projects/space";
import { activeOf, afterBatch, chosenVisible, latest, listLines, plan, question, removeArgs, stateOf, whyNotDeletable } from "./view";

const row = (path: string, o: Partial<SpaceRow> = {}): SpaceRow => ({ path, branch: null, isMain: false, size: { bytes: 1024, files: 3, incomplete: false }, modified: 0, reclaimable: true, ...o });
const clean = { changes: [], locked: null, nested: [], stamp: "abc|" };

describe("view-014 space page", () => {
  it("states: main, in use, deletable, kept", () => {
    const active = new Set(["C:/w/b"]);
    expect(stateOf(row("C:/w/a", { isMain: true }), active)).toBe("Main");
    expect(stateOf(row("C:/w/b"), active)).toBe("In use");
    expect(stateOf(row("C:/w/c"), active)).toBe("Deletable");
    expect(stateOf(row("C:/w/d", { reclaimable: false }), active)).toBe("Kept");
  });

  it("a pane open anywhere in a worktree marks it active, slash and case blind", () => {
    expect([...activeOf([row("C:/w/a"), row("C:/w/b")], ["c:\\w\\A", "D:/elsewhere"])]).toEqual(["C:/w/a"]);
  });

  it("plan: clean rows become picks with the stamp; changes, locks, nested worktrees and failed checks are skipped", () => {
    const rows = [row("C:/w/a"), row("C:/w/b"), row("C:/w/c"), row("C:/w/d"), row("C:/w/e")];
    const { picks, skipped } = plan(rows, {
      "C:/w/a": clean,
      "C:/w/b": { ...clean, changes: [" M x.ts"] },
      "C:/w/c": { ...clean, locked: "" },
      "C:/w/d": "git is not installed",
    });
    expect(picks).toEqual([{ path: "C:/w/a", stamp: "abc|" }]);
    expect(skipped.map((s) => s.path)).toEqual(["C:/w/b", "C:/w/c", "C:/w/d", "C:/w/e"]);
    expect(skipped[0].why).toBe("It has 1 uncommitted change");
    expect(skipped[1].why).toContain("locked");
    expect(skipped[2].why).toBe("git is not installed");
    expect(skipped[3].why).toBe("The check did not run");
  });

  it("question: names one worktree, counts several, lists the skipped, null when nothing goes", () => {
    const rows = [row("C:/w/feat", { branch: "feat", size: { bytes: 2 * 1024 * 1024, files: 1, incomplete: false } }), row("C:/w/b")];
    const one = question(rows, [{ path: "C:/w/feat", stamp: "s" }], [{ path: "C:/w/b", why: "It is in use" }]);
    expect(one?.title).toBe("Delete the worktree feat?");
    expect(one?.confirm).toBe("Delete");
    expect(one?.lines[0]).toMatch(/^2 MB comes back/);
    expect(one?.lines[1]).toBe("Skipped b: It is in use");
    const two = question(rows, [{ path: "C:/w/feat", stamp: "s" }, { path: "C:/w/b", stamp: "t" }], []);
    expect(two?.title).toBe("Delete 2 worktrees?");
    expect(two?.confirm).toBe("Delete 2");
    expect(question(rows, [], [{ path: "C:/w/b", why: "x" }])).toBeNull();
  });

  it("afterBatch drops the removed rows and keeps the others with their messages", () => {
    const rows = [row("C:/w/a"), row("C:/w/b"), row("C:/w/c")];
    const out = afterBatch(rows, { summary: "1 removed, 1 failed", items: [{ path: "C:/w/a", outcome: "removed", message: null }, { path: "C:/w/b", outcome: "failed", message: "folder is open in another program" }] });
    expect(out.rows.map((r) => r.path)).toEqual(["C:/w/b", "C:/w/c"]);
    expect(out.note).toBe("1 removed, 1 failed · b: folder is open in another program");
  });

  it("batch delete keeps branches, matching the dialog's promise", () => {
    expect(removeArgs("p1", [{ path: "C:/w/a", stamp: "s" }])).toEqual({ projectId: "p1", picks: [{ path: "C:/w/a", stamp: "s" }], force: false, keepBranch: true });
    expect(question([row("C:/w/a")], [{ path: "C:/w/a", stamp: "s" }], [])?.lines[0]).toContain("the branches stay");
  });

  it("the batch question lists worktrees by branch/folder and size, capped with 'and N more'", () => {
    const rows = Array.from({ length: 11 }, (_, i) => row(`C:/w/d${i}`, { branch: i === 0 ? "feat" : null }));
    const lines = listLines(rows);
    expect(lines).toHaveLength(9);
    expect(lines[0]).toBe("feat (1 KB)");
    expect(lines[1]).toBe("d1 (1 KB)");
    expect(lines[8]).toBe("and 3 more");
    expect(listLines(rows.slice(0, 8))).toHaveLength(8);
    const picks = rows.map((r) => ({ path: r.path, stamp: "s" }));
    expect(question(rows, picks, [])?.list).toEqual(lines);
    expect(question([rows[0]], [picks[0]], [])?.list).toEqual([]);
  });

  it("ticked rows the filter hides are not deleted", () => {
    const rows = [row("C:/w/a"), row("C:/w/b"), row("C:/w/c")];
    expect(chosenVisible(["C:/w/a", "C:/w/b", "C:/w/gone"], [rows[1], rows[2]], rows)).toEqual(["C:/w/b"]);
  });

  it("whyNotDeletable names the reason, null for a deletable row", () => {
    const active = new Set(["C:/w/b"]);
    expect(whyNotDeletable(row("C:/w/a", { isMain: true }), active)).toMatch(/main checkout/);
    expect(whyNotDeletable(row("C:/w/b"), active)).toMatch(/In use/);
    expect(whyNotDeletable(row("C:/w/c", { reclaimable: false }), active)).toMatch(/Kept/);
    expect(whyNotDeletable(row("C:/w/d"), active)).toBeNull();
  });

  it("latest-wins: only the newest scan token is current", () => {
    const l = latest();
    const a = l.begin();
    const b = l.begin();
    expect(l.current(a)).toBe(false);
    expect(l.current(b)).toBe(true);
    l.cancel();
    expect(l.current(b)).toBe(false);
  });
});

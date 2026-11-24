// LAG-06 (board card LAG-06-SWEEP): the sidebar's 5 s poll asked git about EVERY project on every tick
// (one `workspace_scan` per project per tick). These tests count the scans the new plan asks for.
import { describe, expect, it } from "vitest";
import { SWEEP_IDLE_EVERY, SWEEP_TICK_MS, dueOnTick, isActiveProject, mergePushed } from "./sweepPlan";
import type { Project, Worktree } from "./model";
import type { Pushed } from "../scm/model";

const proj = (n: number): Project => ({ id: `p${n}`, name: `app${n}`, path: `C:/w/app${n}` });
const ten = Array.from({ length: 10 }, (_, i) => proj(i));
const wt = (path: string, isMain = false): Worktree => ({ path, branch: "main", head: "abc", isMain });

/** Every `workspace_scan` the poll would send over ticks 1..ticks (one per due project per tick). */
function scans(projects: Project[], ticks: number, activeDir: string | null, known: Record<string, Worktree[]> = {}, visible = true) {
  const per: Record<string, number> = {};
  const perTick: number[] = [];
  for (let t = 1; t <= ticks; t++) {
    const due = dueOnTick(projects, t, activeDir, known, visible);
    perTick.push(due.length);
    for (const p of due) per[p.id] = (per[p.id] ?? 0) + 1;
  }
  return { total: perTick.reduce((a, b) => a + b, 0), per, perTick };
}

describe("LAG-06 sweep plan", () => {
  it("keeps the 5 s tick and polls the other projects once a minute", () => {
    expect(SWEEP_TICK_MS).toBe(5000);
    expect(SWEEP_IDLE_EVERY).toBe(12);
  });

  it("10 projects, one active, 60 s of ticks: 21 git scans instead of 120", () => {
    const r = scans(ten, 12, "C:/w/app3");
    expect(r.per["p3"], "the active project is scanned on every tick").toBe(12);
    for (const p of ten.filter((p) => p.id !== "p3")) expect(r.per[p.id], `${p.id} is scanned once a minute`).toBe(1);
    expect(r.total, "backend git scans over 60 s (today: 10 x 12 = 120)").toBe(21);
  });

  it("120 s of ticks: every other project exactly twice, the active one 24 times", () => {
    const r = scans(ten, 24, "C:/w/app3");
    expect(r.per["p3"]).toBe(24);
    for (const p of ten.filter((p) => p.id !== "p3")) expect(r.per[p.id], p.id).toBe(2);
    expect(r.total).toBe(42);
  });

  it("the slow scans are spread over the minute, not sent in one burst", () => {
    const r = scans(ten, 24, "C:/w/app3");
    expect(Math.max(...r.perTick), "at most the active project and one other on any tick").toBeLessThanOrEqual(2);
    const thirty = Array.from({ length: 30 }, (_, i) => proj(i));
    const r30 = scans(thirty, 12, "C:/w/app0");
    expect(r30.total, "30 projects, one active, 60 s").toBe(12 + 29);
    expect(Math.max(...r30.perTick), "30 projects: the active one plus at most 3").toBeLessThanOrEqual(4);
  });

  it("follows the exact stagger: position i is due on tick t when (t + i) % 12 is 0", () => {
    const due = (t: number) => dueOnTick(ten, t, null, {}, true).map((p) => p.id);
    expect(due(12)).toEqual(["p0"]);
    expect(due(11)).toEqual(["p1"]);
    expect(due(3)).toEqual(["p9"]);
    expect(due(2)).toEqual([]);
    expect(due(1)).toEqual([]);
    expect(due(0)).toEqual(["p0"]);
  });

  it("no active folder: every project is polled once a minute and nothing more", () => {
    const r = scans(ten, 12, null);
    expect(r.total).toBe(10);
    for (const p of ten) expect(r.per[p.id], p.id).toBe(1);
  });

  it("a hidden window asks git about nothing", () => {
    expect(scans(ten, 24, "C:/w/app3", {}, false).total).toBe(0);
    expect(dueOnTick(ten, 12, "C:/w/app0", {}, false)).toEqual([]);
  });

  it("returns the project objects in list order, with no copies", () => {
    const due = dueOnTick(ten, 12, "C:/w/app5", {}, true);
    expect(due).toEqual([ten[0], ten[5]]);
    expect(due[0]).toBe(ten[0]);
    expect(dueOnTick([], 12, "C:/w/app5", {}, true)).toEqual([]);
  });

  it("an active project is one whose folder holds the active folder, matched across slash and case", () => {
    expect(isActiveProject(proj(1), "C:/w/app1", {})).toBe(true);
    expect(isActiveProject(proj(1), "c:\\W\\App1\\", {})).toBe(true);
    expect(isActiveProject(proj(1), "C:/w/app1/src/deep", {})).toBe(true);
    expect(isActiveProject(proj(1), "C:/w/app10", {}), "a name prefix is not inside").toBe(false);
    expect(isActiveProject(proj(1), "C:/w", {}), "the parent folder is not inside").toBe(false);
    expect(isActiveProject(proj(1), null, {})).toBe(false);
  });

  it("an active project is also one with a known worktree at or above the active folder", () => {
    const known = { p1: [wt("C:/w/app1", true), wt("D:/trees/app1-fix")], p2: [wt("C:/w/app2", true)] };
    expect(isActiveProject(proj(1), "D:/trees/app1-fix", known)).toBe(true);
    expect(isActiveProject(proj(1), "d:\\trees\\app1-fix\\src", known)).toBe(true);
    expect(isActiveProject(proj(2), "D:/trees/app1-fix", known), "another project's worktree").toBe(false);
    expect(isActiveProject(proj(1), "D:/trees/app1-fixed", known)).toBe(false);
    const r = scans(ten, 12, "D:/trees/app1-fix", known);
    expect(r.per["p1"], "a worktree in front keeps its project on the fast poll").toBe(12);
    expect(r.total).toBe(21);
  });

  it("nested projects: both the outer and the inner project count as active", () => {
    const outer: Project = { id: "o", name: "w", path: "C:/w" };
    const list = [outer, ...ten];
    const due = dueOnTick(list, 5, "C:/w/app2/src", {}, true).map((p) => p.id);
    expect(due).toContain("o");
    expect(due).toContain("p2");
  });
});

describe("LAG-06 pushed badges", () => {
  const ps = (path: string, count: number): Pushed => ({ path, state: count ? "ahead" : "synced", count });
  it("replaces only the folders that were asked and keeps every other badge", () => {
    const old = { "C:/w/a": ps("C:/w/a", 1), "C:/w/b": ps("C:/w/b", 2), "C:/w/c": ps("C:/w/c", 3) };
    const out = mergePushed(old, [ps("C:/w/b", 5)], ["C:/w/b", "C:/w/c"]);
    expect(out).toEqual({ "C:/w/a": ps("C:/w/a", 1), "C:/w/b": ps("C:/w/b", 5) });
    expect(old["C:/w/c"], "the old map is not changed").toEqual(ps("C:/w/c", 3));
    expect(Object.keys(old)).toHaveLength(3);
  });
  it("adds a new folder's badge and keeps the rest when nothing was asked", () => {
    expect(mergePushed({}, [ps("C:/w/n", 0)], ["C:/w/n"])).toEqual({ "C:/w/n": ps("C:/w/n", 0) });
    const old = { "C:/w/a": ps("C:/w/a", 1) };
    expect(mergePushed(old, [], [])).toEqual(old);
  });
});

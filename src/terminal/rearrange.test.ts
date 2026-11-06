import { describe, expect, it } from "vitest";
import { dropCell, dropTab, halfOf, showsDragHandle, zoneOf } from "./rearrange";
import { cellsOf } from "./grid";
import { clampView, forgetView, keepView, keptCount, takeView } from "./viewKeep";

type P = { key: number; cwd: string | null; group?: number };
const p = (key: number, group?: number, cwd: string | null = "/w"): P => ({ key, cwd, ...(group === undefined ? {} : { group }) });
const shape = (panes: P[]) => cellsOf(panes).map((c) => c.panes.map((x) => x.key));

describe("TERM-015 drag handle and zones", () => {
  it("shows the handle only with more than one cell", () => {
    expect(showsDragHandle(1)).toBe(false);
    expect(showsDragHandle(2)).toBe(true);
  });
  it("outer bands split, the centre and the strip join", () => {
    const r = { left: 0, top: 0, width: 100, height: 100 };
    expect(zoneOf(5, 50, r, false)).toBe("left");
    expect(zoneOf(95, 50, r, false)).toBe("right");
    expect(zoneOf(50, 5, r, false)).toBe("top");
    expect(zoneOf(50, 95, r, false)).toBe("bottom");
    expect(zoneOf(50, 50, r, false)).toBe("centre");
    expect(zoneOf(50, 5, r, true)).toBe("strip"); // hovering a strip is never a top-edge split
    expect(zoneOf(5, 5, r, true)).toBe("left");
  });
  it("the right half of a tab is after, the left half before", () => {
    expect(halfOf(60, { left: 0, width: 100 })).toBe("after");
    expect(halfOf(40, { left: 0, width: 100 })).toBe("before");
  });
});

describe("dropCell (pane header drag)", () => {
  const panes = [p(1), p(2), p(3)];
  it("dropping A on the right of B swaps the order", () => {
    const next = dropCell(panes, 1, { group: 2, zone: "right" }) as P[];
    expect(shape(next)).toEqual([[2], [1], [3]]);
  });
  it("dropping on the left of a cell puts it before", () => {
    expect(shape(dropCell(panes, 3, { group: 1, zone: "left" }) as P[])).toEqual([[3], [1], [2]]);
  });
  it("a drop on itself or onto the position it holds does nothing", () => {
    expect(dropCell(panes, 1, { group: 1, zone: "right" })).toBeNull();
    expect(dropCell(panes, 1, { group: 2, zone: "left" })).toBeNull();
  });
  it("the centre folds its tabs into the target cell", () => {
    const next = dropCell(panes, 1, { group: 3, zone: "centre" }) as P[];
    expect(shape(next)).toEqual([[2], [3, 1]]);
  });
  it("another workspace is never a target", () => {
    expect(dropCell([p(1), p(2, undefined, "/other")], 1, { group: 2, zone: "right" })).toBeNull();
  });
  it("moves a multi-tab cell as a whole", () => {
    const withTabs = [p(1), p(2, 1), p(3)];
    expect(shape(dropCell(withTabs, 1, { group: 3, zone: "right" }) as P[])).toEqual([[3], [1, 2]]);
  });
});

describe("TERM-054 dropTab", () => {
  const strip = [p(1), p(2, 1), p(3, 1), p(4)];
  it("tab 1 on the right half of tab 3 makes it third", () => {
    const r = dropTab(strip, 1, { kind: "tab", key: 3, half: "after" }) as { panes: P[]; group: number };
    expect(shape(r.panes)).toEqual([[2, 3, 1], [4]]);
    expect(cellsOf(r.panes)[0].group).toBe(r.group);
  });
  it("the left half places it before", () => {
    const r = dropTab(strip, 3, { kind: "tab", key: 2, half: "before" }) as { panes: P[]; group: number };
    expect(shape(r.panes)).toEqual([[1, 3, 2], [4]]);
  });
  it("a tab dropped on itself, or where it already sits, changes nothing", () => {
    expect(dropTab(strip, 2, { kind: "tab", key: 2, half: "after" })).toBeNull();
    expect(dropTab(strip, 2, { kind: "tab", key: 3, half: "before" })).toBeNull();
  });
  it("a tab dropped on another cell's tab moves into that cell", () => {
    const r = dropTab(strip, 4, { kind: "tab", key: 2, half: "after" }) as { panes: P[]; group: number };
    expect(shape(r.panes)).toEqual([[1, 2, 4, 3]]);
  });
  it("the root of a group leaving does not take the group id with it", () => {
    const r = dropTab(strip, 1, { kind: "tab", key: 4, half: "after" }) as { panes: P[]; group: number };
    expect(shape(r.panes)).toEqual([[2, 3], [4, 1]]);
    const ids = cellsOf(r.panes).map((c) => c.group);
    expect(new Set(ids).size).toBe(2);
  });
  it("the centre or strip adds a tab to that cell's group", () => {
    const r = dropTab(strip, 4, { kind: "cell", group: 1, zone: "strip" }) as { panes: P[]; group: number };
    expect(shape(r.panes)).toEqual([[1, 2, 3, 4]]);
    expect(dropTab(strip, 2, { kind: "cell", group: 1, zone: "centre" })).not.toBeNull(); // goes last in its own group
    expect(dropTab([p(1), p(2, 1)], 2, { kind: "cell", group: 1, zone: "centre" })).toBeNull(); // already last
  });
  it("an outer band opens a new cell on that side", () => {
    const r = dropTab(strip, 3, { kind: "cell", group: 4, zone: "right" }) as { panes: P[]; group: number };
    expect(shape(r.panes)).toEqual([[1, 2], [4], [3]]);
    const l = dropTab(strip, 3, { kind: "cell", group: 4, zone: "left" }) as { panes: P[]; group: number };
    expect(shape(l.panes)).toEqual([[1, 2], [3], [4]]);
    expect(l.group).toBe(3);
  });
  it("a lone tab dropped on its own band would recreate the layout, so nothing happens", () => {
    expect(dropTab([p(1), p(2)], 2, { kind: "cell", group: 2, zone: "left" })).toBeNull();
    expect(dropTab([p(1), p(2)], 1, { kind: "cell", group: 2, zone: "left" })).toBeNull(); // already left of it
  });
  it("a full workspace refuses a new cell", () => {
    const full = Array.from({ length: 24 }, (_, i) => p(i + 1));
    const crowded = [...full, p(25, 1)];
    expect(dropTab(crowded, 25, { kind: "cell", group: 5, zone: "right" })).toBeNull();
  });
  it("another workspace is never a target", () => {
    expect(dropTab([p(1), p(2, undefined, "/x")], 1, { kind: "cell", group: 2, zone: "right" })).toBeNull();
  });
});

describe("T-102-b an editor rebuilt by a move keeps its state", () => {
  it("keeps per tab, takes once, bounds the store", () => {
    keepView(7, { anchor: 5, head: 9, scrollTop: 120, scrollLeft: 3 });
    keepView(8, { anchor: 1, head: 1, scrollTop: 0, scrollLeft: 0 });
    expect(takeView(7)).toEqual({ anchor: 5, head: 9, scrollTop: 120, scrollLeft: 3 });
    expect(takeView(7)).toBeNull();
    forgetView(8);
    expect(takeView(8)).toBeNull();
    for (let i = 0; i < 100; i++) keepView(1000 + i, { anchor: 0, head: 0, scrollTop: 0, scrollLeft: 0 });
    expect(keptCount()).toBeLessThanOrEqual(64);
    expect(takeView(1000)).toBeNull(); // the oldest went first
    expect(takeView(1099)).not.toBeNull();
  });
  it("clamps to a shorter file", () => {
    expect(clampView({ anchor: 50, head: 90, scrollTop: -5, scrollLeft: 2 }, 40)).toEqual({ anchor: 40, head: 40, scrollTop: 0, scrollLeft: 2 });
  });
});

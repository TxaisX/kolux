import { describe, expect, it } from "vitest";
import { dropCell, showsDragHandle, zoneOf } from "./rearrange";
import { cellsOf } from "./grid";
import { clampView, forgetView, keepView, keptCount, takeView } from "./viewKeep";

type P = { key: number; cwd: string | null };
const p = (key: number, cwd: string | null = "/w"): P => ({ key, cwd });
const shape = (panes: P[]) => cellsOf(panes).map((c) => c.panes.map((x) => x.key));

describe("TERM-015 drag handle and zones", () => {
  it("shows the handle only with more than one cell", () => {
    expect(showsDragHandle(1)).toBe(false);
    expect(showsDragHandle(2)).toBe(true);
  });
  it("outer bands move the pane to that side, the centre swaps", () => {
    const r = { left: 0, top: 0, width: 100, height: 100 };
    expect(zoneOf(5, 50, r)).toBe("left");
    expect(zoneOf(95, 50, r)).toBe("right");
    expect(zoneOf(50, 5, r)).toBe("top");
    expect(zoneOf(50, 95, r)).toBe("bottom");
    expect(zoneOf(50, 50, r)).toBe("centre");
    expect(zoneOf(5, 5, r)).toBe("left");
    expect(zoneOf(5, 5, { left: 0, top: 0, width: 0, height: 0 })).toBe("centre");
  });
});

// One session per cell (owner decision 2026-11-12): a pane's header grip moves the pane among the grid's cells.
describe("dropCell (pane header drag)", () => {
  const panes = [p(1), p(2), p(3)];
  it("dropping A on the right of B puts A after B", () => {
    const next = dropCell(panes, 1, { group: 2, zone: "right" }) as P[];
    expect(shape(next)).toEqual([[2], [1], [3]]);
  });
  it("dropping on the left of a cell puts it before", () => {
    expect(shape(dropCell(panes, 3, { group: 1, zone: "left" }) as P[])).toEqual([[3], [1], [2]]);
    expect(shape(dropCell(panes, 3, { group: 1, zone: "top" }) as P[])).toEqual([[3], [1], [2]]);
    expect(shape(dropCell(panes, 1, { group: 3, zone: "bottom" }) as P[])).toEqual([[2], [3], [1]]);
  });
  it("a drop on itself or onto the position it holds does nothing", () => {
    expect(dropCell(panes, 1, { group: 1, zone: "right" })).toBeNull();
    expect(dropCell(panes, 1, { group: 1, zone: "centre" })).toBeNull();
    expect(dropCell(panes, 1, { group: 2, zone: "left" })).toBeNull();
  });
  it("the centre swaps the two panes, every other cell keeps its place", () => {
    const four = [p(1), p(2), p(3), p(4)];
    expect(shape(dropCell(four, 1, { group: 3, zone: "centre" }) as P[])).toEqual([[3], [2], [1], [4]]);
    expect(shape(dropCell(four, 4, { group: 2, zone: "centre" }) as P[])).toEqual([[1], [4], [3], [2]]);
  });
  it("the panes are the same objects, so every session keeps running (TERM-017)", () => {
    const next = dropCell(panes, 3, { group: 1, zone: "centre" }) as P[];
    expect(new Set(next)).toEqual(new Set(panes));
    expect(next.every((x) => panes.includes(x))).toBe(true);
  });
  it("another workspace is never a target, and panes of other workspaces between them stay put", () => {
    expect(dropCell([p(1), p(2, "/other")], 1, { group: 2, zone: "right" })).toBeNull();
    const mixed = [p(1), p(9, "/other"), p(2)];
    expect((dropCell(mixed, 1, { group: 2, zone: "centre" }) as P[]).map((x) => x.key)).toEqual([2, 9, 1]);
  });
  it("a pane that is gone is never moved", () => {
    expect(dropCell(panes, 7, { group: 1, zone: "left" })).toBeNull();
    expect(dropCell(panes, 1, { group: 7, zone: "left" })).toBeNull();
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

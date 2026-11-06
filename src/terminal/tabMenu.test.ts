import { describe, expect, it } from "vitest";
import { cellKeys, splitMenuState, splitTabOut } from "./tabSplit";
import { cellsOf } from "./grid";
import { colorOf, forgetColors, setTabColor, tabMenuHead, tabStyle, TAB_COLORS } from "./tabColor";

type P = { key: number; cwd: string | null; group?: number };
const p = (key: number, group?: number, cwd: string | null = "/w"): P => ({ key, cwd, ...(group === undefined ? {} : { group }) });
const shape = (panes: P[]) => cellsOf(panes).map((c) => c.panes.map((x) => x.key));

describe("TERM-049 split items", () => {
  const strip = [p(1), p(2, 1), p(3, 1)];
  it("Split Right moves the tab into a cell of its own beside its old one", () => {
    const r = splitTabOut(strip, 3, "right") as { panes: P[]; stack: boolean };
    expect(shape(r.panes)).toEqual([[1, 2], [3]]);
    expect(r.stack).toBe(false);
  });
  it("Split Down on a lone cell makes a stacked pair", () => {
    const r = splitTabOut(strip, 2, "down") as { panes: P[]; stack: boolean };
    expect(shape(r.panes)).toEqual([[1, 3], [2]]);
    expect(r.stack).toBe(true);
  });
  it("the group's root can leave without dragging the others with it", () => {
    const r = splitTabOut(strip, 1, "right") as { panes: P[]; stack: boolean };
    expect(shape(r.panes)).toEqual([[2, 3], [1]]);
    expect(new Set(cellsOf(r.panes).map((c) => c.group)).size).toBe(2);
  });
  it("lands before the next cell, not at the end", () => {
    const r = splitTabOut([p(1), p(2, 1), p(3)], 2, "right") as { panes: P[]; stack: boolean };
    expect(shape(r.panes)).toEqual([[1], [2], [3]]);
  });
  it("is off for a tab alone in its cell, and for a full workspace", () => {
    expect(splitTabOut([p(1), p(2)], 1, "right")).toBeNull();
    expect(splitMenuState([p(1), p(2)], 1).enabled).toBe(false);
    expect(splitMenuState(strip, 2)).toEqual({ enabled: true, why: null });
    const full = [...Array.from({ length: 24 }, (_, i) => p(i + 1)), p(25, 1)];
    expect(splitMenuState(full, 25).enabled).toBe(false);
    expect(splitTabOut(full, 25, "right")).toBeNull();
  });
  it("cellKeys lists every tab of the cell for one close question", () => {
    expect(cellKeys(strip, 3)).toEqual([1, 2, 3]);
    expect(cellKeys(strip, 99)).toEqual([]);
  });
});

describe("TERM-049 Tab Color and menu head", () => {
  it("sets, replaces and clears a colour; the same pick toggles it off", () => {
    let c = setTabColor({}, 4, "blue");
    expect(colorOf(c, 4)?.id).toBe("blue");
    c = setTabColor(c, 4, "red");
    expect(colorOf(c, 4)?.id).toBe("red");
    c = setTabColor(c, 4, "red");
    expect(colorOf(c, 4)).toBeNull();
    expect(setTabColor({ 4: "red" }, 4, null)).toEqual({});
    expect(setTabColor({}, 4, "mauve")).toEqual({});
  });
  it("forgets closed tabs and styles a coloured one", () => {
    expect(forgetColors({ 1: "red", 2: "blue" }, [1])).toEqual({ 2: "blue" });
    expect((tabStyle({ 1: "red" }, 1) as Record<string, string>)["--tab-dot"]).toBe(TAB_COLORS.find((c) => c.id === "red")!.css);
    expect(tabStyle({}, 1)).toBeUndefined();
  });
  it("heads the menu: Change Title for terminals, Pin, Tab Color, then the splits", () => {
    const ids = (kind: string | undefined) => tabMenuHead(kind, false, { enabled: true, why: null }).map((e) => e.id);
    expect(ids(undefined)).toEqual(["rename", "pin", "color", "splitRight", "splitDown"]);
    expect(ids("editor")).toEqual(["pin", "color", "splitRight", "splitDown"]);
    expect(tabMenuHead("browser", true, { enabled: false, why: "x" })[0]).toEqual({ id: "pin", label: "Unpin tab" });
    const off = tabMenuHead(undefined, false, { enabled: false, why: "alone" })[4];
    expect(off).toMatchObject({ id: "splitDown", disabled: true, why: "alone" });
  });
});


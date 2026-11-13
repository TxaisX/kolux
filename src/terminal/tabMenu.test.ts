import { describe, expect, it } from "vitest";
import { bulkCloses } from "./pin";
import { colorOf, forgetColors, setTabColor, tabMenuHead } from "./tabColor";

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
  it("forgets closed tabs", () => {
    expect(forgetColors({ 1: "red", 2: "blue" }, [1])).toEqual({ 2: "blue" });
  });
  it("heads the menu: Change Title for terminals, Pin, Tab Color, then the splits", () => {
    const ids = (kind: string | undefined) => tabMenuHead(kind, false, { enabled: true, why: null }).map((e) => e.id);
    expect(ids(undefined)).toEqual(["rename", "pin", "color", "splitRight", "splitDown"]);
    expect(ids("editor")).toEqual(["pin", "color", "splitRight", "splitDown"]);
    expect(tabMenuHead("diff", true, { enabled: false, why: "x" })[0]).toEqual({ id: "pin", label: "Unpin tab" });
    const off = tabMenuHead(undefined, false, { enabled: false, why: "full" })[4];
    expect(off).toMatchObject({ id: "splitDown", disabled: true, why: "full" });
  });
});

// One session per cell (2026-11-12): a terminal's tab menu items live in its Pane menu, the bulk closes among them.
describe("TERM-044 the Pane menu's bulk closes", () => {
  it("offers only the rows that would close a pane besides this one, pinned panes spared", () => {
    const names = (order: number[], key: number, pinned: number[] = []) => bulkCloses(order, key, new Set(pinned)).map((r) => [r.name, r.keys]);
    expect(names([1, 2, 3], 2)).toEqual([["Close Others", [1, 3]], ["Close to the Right", [3]], ["Close to the Left", [1]], ["Close All", [1, 2, 3]]]);
    expect(names([1, 2, 3], 1)).toEqual([["Close Others", [2, 3]], ["Close to the Right", [2, 3]], ["Close All", [1, 2, 3]]]);
    expect(names([1, 2, 3], 2, [1, 3])).toEqual([]); // the others are pinned, and Close All would be Close Pane again
    expect(names([7], 7)).toEqual([]); // a lone pane: Close Pane is all there is
    expect(bulkCloses([1, 2], 1, new Set()).every((r) => r.id.startsWith("close-") && r.title.length > 0)).toBe(true);
  });
});


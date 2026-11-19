import { describe, expect, it } from "vitest";
import { bulkCloseSet, closeOne, middleClickCloses, orderPinnedFirst, pinAsks, pinMenu, pinQuestion } from "./pin";

describe("TERM-046 pinned tabs", () => {
  const pinned = new Set([3]);
  const order = [1, 2, 3, 4];

  it("sits pinned tabs first, each group in its own order", () => {
    expect(orderPinnedFirst(order, pinned)).toEqual([3, 1, 2, 4]);
    expect(orderPinnedFirst(order, new Set([4, 2]))).toEqual([2, 4, 1, 3]);
    expect(orderPinnedFirst(order, new Set())).toEqual(order);
  });

  it("puts Pin/Unpin in the tab menu and disables Close for a pinned tab", () => {
    expect(pinMenu(undefined, false).map((i) => i.id)).toEqual(["rename", "pin", "close"]);
    expect(pinMenu(undefined, false).find((i) => i.id === "pin")?.label).toBe("Pin tab");
    const menu = pinMenu("editor", true);
    expect(menu.map((i) => i.id)).toEqual(["pin", "close"]);
    expect(menu.find((i) => i.id === "pin")?.label).toBe("Unpin tab");
    expect(menu.find((i) => i.id === "close")?.disabled).toBe(true);
    expect(pinMenu(undefined, false).find((i) => i.id === "close")?.disabled).toBe(false);
  });

  it("skips pinned tabs in Close others / left / right / all unless confirmed", () => {
    expect(bulkCloseSet(order, 1, "others", pinned)).toEqual([2, 4]);
    expect(bulkCloseSet(order, 1, "right", pinned)).toEqual([2, 4]);
    expect(bulkCloseSet(order, 4, "left", pinned)).toEqual([1, 2]);
    expect(bulkCloseSet(order, 1, "all", pinned)).toEqual([1, 2, 4]);
    // a confirmed kill-all takes the pinned terminal too, with no second prompt
    expect(bulkCloseSet(order, 1, "all", pinned, true)).toEqual([1, 2, 3, 4]);
  });

  it("asks before closing one pinned tab (Mod+W), closes an unpinned tab at once, and honours the off switch", () => {
    expect(closeOne(3, pinned, {})).toBe("ask");
    expect(closeOne(1, pinned, {})).toBe("close");
    expect(closeOne(3, pinned, { pinnedTabsAsk: false })).toBe("close");
    expect(pinAsks({})).toBe(true);
    expect(pinQuestion("build").title).toBe("Close pinned tab “build”?");
  });

  it("never closes a pinned tab on middle-click", () => {
    expect(middleClickCloses(3, pinned)).toBe(false);
    expect(middleClickCloses(1, pinned)).toBe(true);
  });
});

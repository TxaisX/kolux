import { afterEach, describe, expect, it } from "vitest";
import { cancelHandOver, handOver, handedOver, movedKeys, takeOver } from "./handover";
import { moveToTab } from "../shell/tidy";
import { dropCell, dropTab } from "./rearrange";
import { splitTabOut } from "./tabSplit";

const p = (key: number, group = key, cwd = "/r") => ({ key, group, cwd });

afterEach(() => cancelHandOver([1, 2, 3, 4, 5]));

describe("DT-C248: movedKeys names the panes React will unmount and mount again", () => {
  it("is the keys whose group changed, not the ones reordered inside their cell or added", () => {
    const before = [p(1), p(2), p(3, 2)];
    expect(movedKeys(before, [p(1), p(3, 1), p(2)])).toEqual([3]);
    expect(movedKeys(before, [p(1), p(3, 2), p(2)])).toEqual([]); // reordered within cell 2
    expect(movedKeys(before, [p(1), p(2), p(3, 2), p(4)])).toEqual([]); // a new pane has no terminal to hand over
    expect(movedKeys(before, [p(1), p(2)])).toEqual([]); // a closed pane is reaped, never handed over
  });

  it("Move to Tab (TERM-016): the folded pane changes cell, its neighbour does not", () => {
    const four = [p(1), p(2), p(3), p(4)];
    const r = moveToTab(four, 3)!;
    expect(movedKeys(four, r.panes)).toEqual([3]);
  });

  it("a tab dragged onto another cell (TERM-054) moves; one dragged along its own strip does not", () => {
    const panes = [p(1), p(2, 1), p(5, 1), p(3), p(4, 3)];
    const across = dropTab(panes, 2, { kind: "tab", key: 4, half: "after" })!;
    expect(movedKeys(panes, across.panes)).toEqual([2]);
    const along = dropTab(panes, 5, { kind: "tab", key: 1, half: "before" })!;
    expect(movedKeys(panes, along.panes)).toEqual([]);
  });

  it("the first tab of a cell dragged along its own strip renumbers the cell, so every tab in it is drawn anew and handed over", () => {
    const panes = [p(1), p(2, 1), p(3)];
    const along = dropTab(panes, 1, { kind: "tab", key: 2, half: "after" })!;
    expect(movedKeys(panes, along.panes).sort()).toEqual([1, 2]);
  });

  it("a cell folded into another (TERM-015) moves every tab it held", () => {
    const panes = [p(1), p(2, 1), p(3)];
    const next = dropCell(panes, 1, { group: 3, zone: "centre" })!;
    expect(movedKeys(panes, next).sort()).toEqual([1, 2]);
  });

  it("Split Right on a tab (TERM-049) moves that tab into a cell of its own", () => {
    const panes = [p(1), p(2, 1)];
    const r = splitTabOut(panes, 2, "right")!;
    expect(movedKeys(panes, r.panes)).toEqual([2]);
  });
});

describe("DT-C248: the hand-over mark lives from the layout change to the next mount", () => {
  it("is seen by the unmount and taken once by the new mount", () => {
    handOver([5]);
    expect(handedOver(5)).toBe(true);
    expect(handedOver(4)).toBe(false);
    expect(handedOver(undefined)).toBe(false);
    expect(takeOver(5)).toBe(true);
    expect(handedOver(5)).toBe(false);
    expect(takeOver(5)).toBe(false); // a second mount of the key starts plain (dev double mount, or a later close and reopen)
    expect(takeOver(undefined)).toBe(false);
  });

  it("a close cancels the mark, so a stale one never keeps a closed tab's terminal alive", () => {
    handOver([1, 2]);
    cancelHandOver([1]);
    expect(handedOver(1)).toBe(false);
    expect(handedOver(2)).toBe(true);
  });
});

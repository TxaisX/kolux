import { afterEach, describe, expect, it } from "vitest";
import { cancelHandOver, handOver, handedOver, movedKeys, takeOver } from "./handover";
import { moveToTab } from "../shell/tidy";
import { dropCell, dropTab } from "./rearrange";
import { splitTabOut } from "./tabSplit";
import actions from "./paneActions.ts?raw";
import pane from "./TerminalPane.tsx?raw";

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
  it("is seen by the unmount and by the new mount, and taken once the new mount binds its terminal", () => {
    handOver([5]);
    expect(handedOver(5)).toBe(true);
    expect(handedOver(4)).toBe(false);
    expect(handedOver(undefined)).toBe(false);
    expect(handedOver(5)).toBe(true); // the new mount reads it at mount without taking it
    expect(takeOver(5)).toBe(true); // ...and takes it when its terminal id is bound
    expect(handedOver(5)).toBe(false);
    expect(takeOver(5)).toBe(false); // a later mount of the key starts plain (a close and reopen)
    expect(takeOver(undefined)).toBe(false);
  });

  it("a mount unmounted before it bound its terminal passes the mark on (dev double mount, a second move mid-attach)", () => {
    handOver([5]);
    // mount B: reads the mark, is unmounted before its attach answers; its cleanup sees the mark still set
    expect(handedOver(5)).toBe(true);
    const bSawAtCleanup = handedOver(5);
    expect(bSawAtCleanup).toBe(true); // so B's late attach answer does not kill the terminal either
    // mount C of the same key: reads the mark, attaches, binds its id
    expect(handedOver(5)).toBe(true);
    expect(takeOver(5)).toBe(true);
    expect(handedOver(5)).toBe(false);
  });

  it("a close cancels the mark, so a stale one never keeps a closed tab's terminal alive", () => {
    handOver([1, 2]);
    cancelHandOver([1]);
    expect(handedOver(1)).toBe(false);
    expect(handedOver(2)).toBe(true);
  });
});

// DT-C248 review 2: the two leaks the mark alone left, pinned at their source.
describe("DT-C248 review 2: a terminal that no view owns is ended", () => {
  it("a tab closed before its moved or restored pane bound its terminal reaps by pane key, from the close (not the unmount)", () => {
    // The close path: the key leaves the layout, so no later mount can own the terminal; the unmount
    // cannot tell that apart from the dev double mount or a second move, whose next mount takes it.
    const close = actions.indexOf("const dropPanes = (keys: number[]) => {");
    expect(close).toBeGreaterThan(-1);
    const body = actions.slice(close, close + 1500);
    expect(body).toContain("cancelHandOver(keys)");
    expect(body).toContain('invoke("terminal_reap_pane", { paneKey: k })');
    expect(body.indexOf("cancelHandOver(keys)")).toBeLessThan(body.indexOf("terminal_reap_pane"));
    // and the unmount still reaps by id only
    expect(pane).toContain("if (id !== null && killsOnUnmount(gen) && !handed) invoke(\"terminal_kill\", { id })");
    expect(pane).not.toContain('terminal_reap_pane');
  });

  it("a start refused for a view already gone (Rust refuses the older of two starts for one pane) never fails the tab the new view shows", () => {
    const at = pane.indexOf("// DT-C248 review 2: a start that failed for a view already gone");
    expect(at).toBeGreaterThan(-1);
    const branch = pane.slice(at, at + 400);
    expect(branch).toContain("if (!alive) return;");
    expect(branch.indexOf("if (!alive) return;")).toBeLessThan(branch.indexOf("fail(err);"));
  });
});

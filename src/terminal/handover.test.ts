import { afterEach, describe, expect, it } from "vitest";
import { cancelHandOver, handOver, handedOver, movedKeys, takeOver } from "./handover";
import { dropCell } from "./rearrange";
import actions from "./paneActions.ts?raw";
import pane from "./TerminalPane.tsx?raw";

const p = (key: number, cwd = "/r") => ({ key, cwd });

afterEach(() => cancelHandOver([1, 2, 3, 4, 5]));

describe("DT-C248: movedKeys names the panes React will unmount and mount again", () => {
  it("is the keys whose cell changed; one session per cell (2026-11-12) keys every cell by its pane, so none does", () => {
    const before = [p(1), p(2), p(3)];
    expect(movedKeys(before, [p(1), p(3), p(2)])).toEqual([]); // reordered cells keep their element
    expect(movedKeys(before, [p(1), p(2), p(3), p(4)])).toEqual([]); // a new pane has no terminal to hand over
    expect(movedKeys(before, [p(1), p(2)])).toEqual([]); // a closed pane is reaped, never handed over
  });

  it("a pane dragged onto another cell (TERM-015), swapped or put to one side, is never drawn anew", () => {
    const panes = [p(1), p(2), p(3), p(4)];
    const swapped = dropCell(panes, 1, { group: 3, zone: "centre" })!;
    expect(swapped.map((x) => x.key)).toEqual([3, 2, 1, 4]);
    expect(movedKeys(panes, swapped)).toEqual([]);
    const beside = dropCell(panes, 4, { group: 1, zone: "left" })!;
    expect(beside.map((x) => x.key)).toEqual([4, 1, 2, 3]);
    expect(movedKeys(panes, beside)).toEqual([]);
  });

  it("the window still checks every move: the drop hands over whatever movedKeys finds", () => {
    const drop = actions.indexOf("const dropCellOn = (group: number, target: { group: number; zone: Zone }) => {");
    expect(drop).toBeGreaterThan(-1);
    const body = actions.slice(drop, drop + 300);
    expect(body.indexOf("handOver(movedKeys(panes, next))")).toBeGreaterThan(-1);
    expect(body.indexOf("handOver(movedKeys(panes, next))")).toBeLessThan(body.indexOf("setPanes(next)"));
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

// DT-C248 review 3: Try again redraws the gap it was not listening through.
describe("DT-C248 review 3: Try again redraws what the running terminal printed while the tab waited", () => {
  it("retryRestore fetches the live snapshot, sets the floor and redraws it before it asks the service to bind", () => {
    const at = pane.indexOf("// DT-C248 review 3: what the terminal printed while the tab waited for Try again");
    expect(at).toBeGreaterThan(-1);
    const branch = pane.slice(at, at + 700);
    const fetched = branch.indexOf('invoke<LiveSnapshot | null>("terminal_live_history", { paneKey: number })');
    const floored = branch.indexOf("resync.took(snap.id, snap);");
    const drawn = branch.indexOf("applySnapshot(term, decodeOutput(snap.data));");
    const bound = branch.indexOf("await reattach(tauriService, number, serviceRef.current)");
    expect(fetched).toBeGreaterThan(-1);
    expect(fetched).toBeLessThan(floored);
    expect(floored).toBeLessThan(drawn);
    expect(drawn).toBeLessThan(bound);
  });
});

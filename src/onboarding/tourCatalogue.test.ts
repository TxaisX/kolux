// ONB-032 rest and ONB-033 rest (T-245-b): the board tour, how a waiting tour behaves
// and the naming rule. T-776 dropped the workspace-creation tour and its hand-over: Kolux makes no extra folders.
import { describe, expect, it } from "vitest";
import {
  autoStarts, BOARD_LANE, FIRST_TARGET_TRIES, gaveUp, lookAt, nameAfterToggle, nextShown, ownerOff, progress,
  replayOf, SIDEBAR_SHOW, TOURS, type Look, type Want,
} from "./tour";

const tour = (id: string) => TOURS.find((t) => t.id === id)!;

describe("the catalogue (ONB-033)", () => {
  it("has the board tour: plan, then cards through the lanes", () => {
    const t = tour("board");
    expect(t.steps).toHaveLength(2);
    expect(t.trigger).toBe(BOARD_LANE);
    expect(t.steps[1].alt).toContain(".board");
  });
  it("p4a-09: the board tour names the columns as states, in the board's own order, not stages", async () => {
    const { LANES } = await import("../board/chip");
    const lane = tour("board").steps.find((s) => s.target === BOARD_LANE)!;
    const body = lane.en.body;
    expect(body).not.toMatch(/stage|first one/i);
    const at = LANES.map((l) => body.indexOf(l.title));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(lane.ko.body).not.toMatch(/첫 열|한 단계/);
  });
  it("the parallel tour's second step opens the sidebar when it is hidden", () => {
    expect(tour("parallel").steps[1].reveal).toBe(SIDEBAR_SHOW);
  });
});

describe("the parallel tour only on a workspace's terminal tab (ONB-033)", () => {
  const base = { id: "parallel" as const, auto: true, seen: [], slotUsed: false, blocked: false, tried: [] };
  it("is offered on a workspace terminal, and not elsewhere", () => {
    expect(autoStarts({ ...base, workspaceTab: true })).toBe(true);
    expect(autoStarts({ ...base, workspaceTab: false })).toBe(false);
  });
  it("the other tours do not care", () => {
    expect(autoStarts({ ...base, id: "board", workspaceTab: false })).toBe(true);
  });
});

describe("progress (ONB-033: a tour with a fixed count always counts it)", () => {
  it("a counted tour reads by position even while one step has no target", () => {
    const present = [true, true, false];
    expect(progress({ count: 3 }, present, 0)).toEqual({ label: "1 of 3", dots: 3, on: 0 });
    expect(progress({ count: 3 }, present, 1)).toEqual({ label: "2 of 3", dots: 3, on: 1 });
    expect(progress({ count: 3 }, [true, true, true], 2)).toEqual({ label: "3 of 3", dots: 3, on: 2 });
  });
  it("other tours count only the steps that show", () => {
    expect(progress({}, [true, false, true], 2)).toEqual({ label: "2 of 2", dots: 2, on: 1 });
  });
  it("with the cookie step missing, the next step after annotate is nothing, so the tour ends on Done", () => {
    expect(nextShown([true, true, false], 1)).toBeNull();
  });
});

const want = (o: Partial<Want> = {}): Want => ({ id: "board", forced: false, tries: 0, page: "|", ...o });
const look = (o: Partial<Look> = {}): Look => ({ running: null, page: "|", firstShown: true, blocked: false, off: false, detached: false, ...o });

describe("a waiting tour (ONB-032)", () => {
  it("starts when its first target shows, but an automatic one not over a confirmation dialog", () => {
    expect(lookAt(want(), look())).toBe("start");
    expect(lookAt(want(), look({ blocked: true }))).toBe("miss");
    expect(lookAt(want({ forced: true }), look({ blocked: true }))).toBe("start");
  });
  it("keeps looking while the target is not there", () => {
    expect(lookAt(want({ forced: true }), look({ firstShown: false }))).toBe("miss");
  });
  it("is held back while the feature that owns it is switched off, unless it is detached", () => {
    expect(lookAt(want(), look({ off: true }))).toBe("drop");
    expect(lookAt(want({ forced: true }), look({ off: true }))).toBe("drop");
    expect(lookAt(want({ id: "parallel", forced: true }), look({ off: true, detached: true }))).toBe("start");
  });
  it("a forced request stops when the user moves to another page", () => {
    expect(lookAt(want({ forced: true }), look({ page: ".board" }))).toBe("drop");
    expect(lookAt(want(), look({ page: ".board" }))).toBe("start");
  });
  it("a forced request stops when another tour starts, unless it holds off for that one", () => {
    expect(lookAt(want({ forced: true }), look({ running: "tasks" }))).toBe("drop");
    expect(lookAt(want({ forced: true, after: "tasks" }), look({ running: "tasks" }))).toBe("wait");
    expect(lookAt(want({ forced: true, after: "tasks" }), look({ running: "automations" }))).toBe("drop");
    // and goes ahead once the one it waited for has finished
    expect(lookAt(want({ forced: true, after: "tasks" }), look({ running: null }))).toBe("start");
  });
  it("an automatic request simply waits while another tour shows", () => {
    expect(lookAt(want(), look({ running: "tasks" }))).toBe("wait");
  });
  it("gives up after about twenty looks (forced: eighty), and a grid kit start has its own limit", () => {
    expect(gaveUp(want({ tries: FIRST_TARGET_TRIES - 1 }))).toBe(false);
    expect(gaveUp(want({ tries: FIRST_TARGET_TRIES }))).toBe(true);
    expect(gaveUp(want({ forced: true, tries: FIRST_TARGET_TRIES }))).toBe(false);
    expect(gaveUp(want({ forced: true, tries: 4 * FIRST_TARGET_TRIES }))).toBe(true);
    expect(gaveUp(want({ limit: 3, tries: 3 }))).toBe(true);
  });
});

describe("the owning feature's switch", () => {
  it("only an explicit false switches a feature off", () => {
    expect(ownerOff({ boardView: false }, "board")).toBe(true);
    expect(ownerOff({ boardView: true }, "board")).toBe(false);
    expect(ownerOff({}, "board")).toBe(false);
    expect(ownerOff(null, "board")).toBe(false);
    expect(ownerOff({ boardView: false }, "parallel")).toBe(false);
  });
});

describe("replay requests", () => {
  it("accepts the old plain id and the new object with a tour to wait for", () => {
    expect(replayOf("tasks")).toEqual({ id: "tasks" });
    expect(replayOf({ id: "board", after: "tasks" })).toEqual({ id: "board", after: "tasks" });
    expect(replayOf({ id: "board" })).toEqual({ id: "board", after: undefined });
    expect(replayOf(null)).toBeNull();
    expect(replayOf({ id: 4 })).toBeNull();
  });
});

describe("automatic naming from the first message (ONB-033)", () => {
  it("turning it on clears a generated name; a typed name stays", () => {
    expect(nameAfterToggle(true, "fix-login-4821", true)).toBe("");
    expect(nameAfterToggle(true, "my-name", false)).toBe("my-name");
  });
  it("turning it off keeps the name", () => {
    expect(nameAfterToggle(false, "fix-login-4821", true)).toBe("fix-login-4821");
  });
});

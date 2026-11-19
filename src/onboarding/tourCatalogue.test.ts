// ONB-032 rest and ONB-033 rest (T-245-b): the parallel tour, how a waiting tour behaves and the naming rule.
// The board, Tasks and Automations tours went with their screens (2026-11-19). T-776 dropped the
// workspace-creation tour and its hand-over: Kolux makes no extra folders.
import { describe, expect, it } from "vitest";
import {
  autoStarts, FIRST_TARGET_TRIES, gaveUp, lookAt, nameAfterToggle, nextShown, progress,
  replayOf, SIDEBAR_SHOW, TOURS, type Look, type Want,
} from "./tour";

const tour = (id: string) => TOURS.find((t) => t.id === id)!;

describe("the catalogue (ONB-033)", () => {
  it("the parallel tour says the sidebar has one dot per folder and each agent's own state is on its pane (job 66)", () => {
    const step = tour("parallel").steps[1];
    expect(step.en.body).not.toMatch(/each has its own dot/i);
    expect(step.en.body).toMatch(/folder's dot/);
    expect(step.en.body).toMatch(/pane's top bar/);
    expect(step.ko.body).not.toMatch(/각자 사이드바에 점이/);
    expect(step.ko.body).toMatch(/폴더 점/);
    // R83-03: the dot is green only when the strongest state is "finished": two idle agents give grey. Both languages say the same.
    // F88-06: an agent waiting its turn ("queued") outranks "finished" and its dot is grey, so the sentence names it too.
    expect(step.en.body).toContain("The folder's dot in the sidebar turns yellow when one of them needs you and green when one has finished and none is still working, waiting its turn or needs you.");
    expect(step.en.body).not.toMatch(/both are done|neither is working/);
    expect(step.ko.body).toContain("사이드바의 폴더 점은 한 에이전트라도 도움이 필요하면 노란색, 한 에이전트가 일을 마쳤고 아직 일하거나 차례를 기다리거나 도움이 필요한 에이전트가 없으면 초록색이 됩니다.");
    expect(step.ko.body).not.toMatch(/둘 다 끝나면|둘 다 일을 멈추면/);
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

const want = (o: Partial<Want> = {}): Want => ({ id: "parallel", forced: false, tries: 0, page: "|", ...o });
const look = (o: Partial<Look> = {}): Look => ({ running: null, page: "|", firstShown: true, blocked: false, ...o });

describe("a waiting tour (ONB-032)", () => {
  it("starts when its first target shows, but an automatic one not over a confirmation dialog", () => {
    expect(lookAt(want(), look())).toBe("start");
    expect(lookAt(want(), look({ blocked: true }))).toBe("miss");
    expect(lookAt(want({ forced: true }), look({ blocked: true }))).toBe("start");
  });
  it("keeps looking while the target is not there", () => {
    expect(lookAt(want({ forced: true }), look({ firstShown: false }))).toBe("miss");
  });
  it("a forced request stops when the user moves to another page", () => {
    expect(lookAt(want({ forced: true }), look({ page: ".settings" }))).toBe("drop");
    expect(lookAt(want(), look({ page: ".settings" }))).toBe("start");
  });
  it("a forced request stops when another tour starts, unless it holds off for that one", () => {
    expect(lookAt(want({ forced: true }), look({ running: "grid" }))).toBe("drop");
    expect(lookAt(want({ forced: true, after: "grid" }), look({ running: "grid" }))).toBe("wait");
    expect(lookAt(want({ forced: true, after: "grid" }), look({ running: "parallel" }))).toBe("drop");
    // and goes ahead once the one it waited for has finished
    expect(lookAt(want({ forced: true, after: "grid" }), look({ running: null }))).toBe("start");
  });
  it("an automatic request simply waits while another tour shows", () => {
    expect(lookAt(want(), look({ running: "grid" }))).toBe("wait");
  });
  it("gives up after about twenty looks (forced: eighty), and a grid kit start has its own limit", () => {
    expect(gaveUp(want({ tries: FIRST_TARGET_TRIES - 1 }))).toBe(false);
    expect(gaveUp(want({ tries: FIRST_TARGET_TRIES }))).toBe(true);
    expect(gaveUp(want({ forced: true, tries: FIRST_TARGET_TRIES }))).toBe(false);
    expect(gaveUp(want({ forced: true, tries: 4 * FIRST_TARGET_TRIES }))).toBe(true);
    expect(gaveUp(want({ limit: 3, tries: 3 }))).toBe(true);
  });
});

describe("replay requests", () => {
  it("accepts the old plain id and the new object with a tour to wait for", () => {
    expect(replayOf("parallel")).toEqual({ id: "parallel" });
    expect(replayOf({ id: "parallel", after: "grid" })).toEqual({ id: "parallel", after: "grid" });
    expect(replayOf({ id: "parallel" })).toEqual({ id: "parallel", after: undefined });
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

import { describe, expect, it } from "vitest";
import { autoStarts, CREATE_AGENT, CREATE_PROJECT, CREATE_NAME, CREATE_NOTE, GRID_PANE, GRID_RESULTS, GRID_STATUS, gridStarts, nextShown, place, prevShown, stepLabel, tourFeature, TOURS } from "./tour";

const base = { id: "tasks" as const, auto: true, seen: [], slotUsed: false, blocked: false, tried: [] };

describe("tour overlay (ONB-031)", () => {
  it("labels steps only when more than one shows and skips missing targets", () => {
    expect(stepLabel(0, 1)).toBeNull();
    expect(stepLabel(1, 3)).toBe("2 of 3");
    expect(nextShown([false, true, true], -1)).toBe(1);
    expect(nextShown([true, false, true], 0)).toBe(2);
    expect(nextShown([true, false], 0)).toBeNull();
    expect(prevShown([true, false, true], 2)).toBe(0);
    expect(prevShown([false, true], 1)).toBeNull();
  });

  it("sits on the preferred side, flips when there is no room and stays inside when nothing fits", () => {
    const b = { left: 0, top: 0, width: 1000, height: 800 };
    const p = { width: 300, height: 120 };
    expect(place({ left: 400, top: 100, width: 40, height: 20 }, p, b, "bottom")).toEqual({ side: "bottom", left: 270, top: 130 });
    expect(place({ left: 400, top: 760, width: 40, height: 20 }, p, b, "bottom").side).toBe("top");
    expect(place({ left: 2, top: 300, width: 40, height: 20 }, p, b, "right")).toEqual({ side: "right", left: 52, top: 250 });
    const r = place({ left: 0, top: 0, width: 1000, height: 800 }, p, b, "bottom");
    expect(r.side).toBeNull();
    expect(r.left).toBeGreaterThanOrEqual(0);
    expect(r.top).toBeGreaterThanOrEqual(0);
  });
});

describe("when tours start by themselves (ONB-032)", () => {
  it("only on a qualifying profile, once, one per launch, never over a dialog", () => {
    expect(autoStarts(base)).toBe(true);
    expect(autoStarts({ ...base, auto: false })).toBe(false);
    expect(autoStarts({ ...base, auto: null })).toBe(false);
    expect(autoStarts({ ...base, seen: ["tasks"] })).toBe(false);
    expect(autoStarts({ ...base, slotUsed: true })).toBe(false);
    expect(autoStarts({ ...base, blocked: true })).toBe(false);
  });
  it("offers the parallel tour only to someone who never split a pane (ONB-033)", () => {
    expect(autoStarts({ ...base, id: "parallel" })).toBe(true);
    expect(autoStarts({ ...base, id: "parallel", tried: ["split"] })).toBe(false);
  });
  it("has the catalogue the store keeps, translated", () => {
    expect(TOURS.map((t) => t.id)).toEqual(["tasks", "automations", "parallel", "grid", "create", "board", "browser"]);
    expect(TOURS.every((t) => t.steps.every((s) => s.ko.title && s.en.title))).toBe(true);
  });
});

describe("the grid tour when the first run ends (ONB-012)", () => {
  it("gridStarts answers yes for a kit or plain-session finish, once, and no for the skip and folder values", () => {
    expect([gridStarts("kit", []), gridStarts("session", [])]).toEqual([true, true]);
    expect([gridStarts("skip", []), gridStarts("folder", [])]).toEqual([false, false]);
    expect(gridStarts("session", ["grid"])).toBe(false);
  });

  it("points at the terminal, then the sidebar status, then the kit results, and never starts by itself", () => {
    const grid = TOURS.find((t) => t.id === "grid")!;
    expect(grid.steps.map((s) => s.target)).toEqual([GRID_PANE, GRID_STATUS, GRID_RESULTS]);
    expect(autoStarts({ ...base, id: "grid" })).toBe(false);
  });
});

describe("the new-workspace tour (ONB-016)", () => {
  it("points at the composer's project, name, agent and note, and only the Setup Guide starts it", () => {
    const t = TOURS.find((x) => x.id === "create")!;
    expect(t.steps.map((s) => s.target)).toEqual([CREATE_PROJECT, CREATE_NAME, CREATE_AGENT, CREATE_NOTE]);
    expect(autoStarts({ ...base, id: "create" })).toBe(false);
    expect(tourFeature("create")).toBe(false);
  });
});

describe("tours and the feature memory (ONB-042, FIX-1)", () => {
  it("tourFeature names a kept feature for every tour but the grid tour (the predicate only; the Tours.tsx call is not covered here)", () => {
    expect(TOURS.filter((t) => tourFeature(t.id)).map((t) => t.id)).toEqual(["tasks", "automations", "parallel", "board", "browser"]);
  });
});

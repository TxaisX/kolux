import { describe, expect, it } from "vitest";
import { doneFrom, nextTip, type Facts } from "./guide";
import { MOVED, movedHint, SPLIT_RETIRED, splitCredit } from "./moved";

const before = MOVED[0].before;
const facts: Facts = { workspaces: [], gitProjects: 0, integrations: null, cli: false, notifications: null, agent: null, setupScript: null };
const base = { seen: [] as string[], tried: [] as string[], cli: { installed: true, onPath: true } as never, onboarding: false };

describe("the moved-control hint (ONB-042)", () => {
  it("reaches only a profile that used the control before it moved", () => {
    expect(movedHint({ usage: { first: before - 1, count: 3 } }, [])).toBe("moved-usage");
    expect(movedHint({ usage: { first: before, count: 3 } }, [])).toBeNull(); // first used at or after the move
    expect(movedHint({ usage: { first: before + 5000, count: 1 } }, [])).toBeNull();
    expect(movedHint({ usage: { first: before - 1, count: 0 } }, [])).toBeNull();
    expect(movedHint({}, [])).toBeNull();
    expect(movedHint(undefined, [])).toBeNull();
  });
  it("shows once", () => {
    expect(movedHint({ usage: { first: 1, count: 2 } }, ["moved-usage"])).toBeNull();
  });
  it("is the one startup tip, ahead of the others, and never in a session that showed the wizard", () => {
    const features = { usage: { first: 1, count: 2 } };
    expect(nextTip({ ...base, features })).toBe("moved-usage");
    expect(nextTip({ ...base, features, seen: ["moved-usage"] })).toBe("palette");
    expect(nextTip({ ...base, features, onboarding: true })).toBeNull();
    expect(nextTip({ ...base })).toBe("palette");
  });
});

describe("the legacy split-pane credit (ONB-015 / ONB-042)", () => {
  it("credits a profile that finished the retired step, or split a pane before it went away", () => {
    expect(splitCredit(["split-terminal"], undefined)).toBe(true);
    expect(splitCredit([], { split: { first: SPLIT_RETIRED - 1, count: 1 } })).toBe(true);
    expect(splitCredit([], { split: { first: SPLIT_RETIRED, count: 4 } })).toBe(false); // a split made after the step was gone
    expect(splitCredit([], { split: { first: 1, count: 0 } })).toBe(false);
    expect(splitCredit(undefined, undefined)).toBe(false);
    expect(splitCredit(["repos-two"], {})).toBe(false);
  });
  it("ticks Multi-task and nothing else; a real workspace still ticks it alone", () => {
    expect([...doneFrom({ ...facts, splitCredit: true })]).toEqual(["multitask"]);
    expect([...doneFrom({ ...facts, splitCredit: false })]).toEqual([]);
    expect([...doneFrom({ ...facts })]).toEqual([]);
    expect([...doneFrom({ ...facts, workspaces: [[{ path: "a", head: "x", isMain: false }]] })]).toEqual(["multitask"]);
  });
});

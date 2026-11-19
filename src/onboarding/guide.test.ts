import { describe, expect, it } from "vitest";
import { completed, doneFrom, doneId, firstOpen, forward, legacyProfile, LEGACY_DONE, milestonesShown, moveOn, nextTip, railKey, ring, stopDone, STEPS, stopOf, visits, withRecord, workflowDone, WORKFLOWS, type Facts, type Place, type StepId } from "./guide";

const set = (...ids: StepId[]) => new Set<StepId>(ids);

describe("Setup Guide (ONB-014)", () => {
  it("has four steps, the Setup group before the parallel-work group", () => {
    // Connect integrations and Automate workspace setup went with Tasks and setup scripts, and Enable Kolux CLI
    // with the command line (2026-11-19).
    expect(STEPS).toHaveLength(4);
    const groups = STEPS.map((s) => s.group);
    expect(groups.lastIndexOf("setup")).toBeLessThan(groups.indexOf("parallel"));
    expect(STEPS.every((s) => s.ko.name && s.ko.about && s.en.name && s.en.about)).toBe(true);
  });

  it("opens on the first unfinished step, Setup first, or on the step asked for", () => {
    expect(firstOpen(set())).toBe("notifications");
    expect(firstOpen(set("notifications", "agent"))).toBe("multitask");
    const setupDone = set(...STEPS.filter((s) => s.group === "setup").map((s) => s.id));
    expect(firstOpen(setupDone)).toBe("multitask");
    expect(firstOpen(set(), "repos")).toBe("repos");
    expect(firstOpen(set(...STEPS.map((s) => s.id)))).toBe("notifications");
  });

  it("moves on once the step showing is done", () => {
    expect(moveOn("agent", set())).toBe("agent");
    expect(moveOn("agent", set("agent"))).toBe("multitask");
    expect(moveOn("repos", set("repos"))).toBe("notifications");
    const all = set(...STEPS.map((s) => s.id));
    expect(moveOn("agent", all)).toBe("agent");
  });

  it("counts core steps in the ring and drops Milestones once they are all done", () => {
    expect(ring(set())).toEqual({ done: 0, total: 4 });
    const core = STEPS.filter((s) => s.core).map((s) => s.id);
    expect(milestonesShown(set(...core.slice(1)))).toBe(true);
    expect(milestonesShown(set(...core))).toBe(false);
  });
});

describe("Explore Kolux (ONB-022)", () => {
  it("opens on workspaces with four workflows on the rail", () => {
    expect(WORKFLOWS.map((w) => w.id)).toEqual(["workspaces", "agents", "workbench", "review"]);
    expect(stopOf({ w: 0, s: -1 }).id).toBe("workspaces");
  });

  it("Continue visits a workflow's stops before the next workflow", () => {
    const seen: string[] = [];
    let at: ReturnType<typeof forward> = { w: 1, s: -1 };
    for (let i = 0; i < 4 && at; i++) {
      at = forward(at);
      if (at) seen.push(stopOf(at).id);
    }
    expect(seen).toEqual(["statuses", "usage", "workbench", "terminal"]);
    expect(forward({ w: 3, s: 2 })).toBeNull();
  });

  it("the rail answers arrows, Home and End and stops at both ends", () => {
    expect(railKey("End", 0)).toBe(3);
    expect(railKey("Home", 3)).toBe(0);
    expect(railKey("ArrowDown", 3)).toBe(3);
    expect(railKey("ArrowUp", 0)).toBe(0);
    expect(railKey("a", 1)).toBeNull();
  });

  it("a workflow is Completed once it and its required stops were visited", () => {
    const agents = WORKFLOWS[1];
    expect(completed(agents, new Set(["agents"]))).toBe(false);
    expect(completed(agents, new Set(["agents", "statuses"]))).toBe(true);
  });
});

describe("startup tips (ONB-027)", () => {
  const none = { seen: [], tried: [], onboarding: false };
  it("shows the palette tip, then nothing", () => {
    expect(nextTip(none)).toBe("palette");
    expect(nextTip({ ...none, seen: ["palette"] })).toBeNull();
    expect(nextTip({ ...none, seen: ["cli"] }), "a profile that saw the retired command-line tip still gets the palette tip").toBe("palette");
  });
  it("shows nothing in a session that showed the first run, and skips a feature already in use", () => {
    expect(nextTip({ ...none, onboarding: true })).toBeNull();
    expect(nextTip({ ...none, tried: ["palette"] })).toBeNull();
  });
});

const none: Facts = { workspaces: null, gitProjects: null, notifications: null, agent: null };
const main = (path = "C:/p"): Place => ({ path, head: "abc123", isMain: true, kind: "main" });

describe("Setup Guide steps tick from real state (ONB-015)", () => {
  it("nothing read, or every read failed, ticks nothing", () => {
    expect([...doneFrom(none)]).toEqual([]);
  });

  it("Multi-task: only the main folder, twice over or with a placeholder, stays unticked; one real workspace ticks it", () => {
    expect(doneFrom({ ...none, workspaces: [[main()]] }).has("multitask")).toBe(false);
    expect(doneFrom({ ...none, workspaces: [[main(), main()]] }).has("multitask")).toBe(false);
    expect(doneFrom({ ...none, workspaces: [[main(), { path: "C:/w/new", head: "", isMain: false, kind: "managed" }]] }).has("multitask")).toBe(false);
    expect(doneFrom({ ...none, workspaces: [[main()], [main("C:/q"), { path: "C:/w/a", head: "def456", isMain: false, kind: "managed" }]] }).has("multitask")).toBe(true);
  });

  it("Multiple repos needs two git projects", () => {
    expect(doneFrom({ ...none, gitProjects: 1 }).has("repos")).toBe(false);
    expect(doneFrom({ ...none, gitProjects: 2 }).has("repos")).toBe(true);
  });

  it("the default agent and notifications steps tick from their own state", () => {
    expect(doneFrom({ ...none, agent: "" }).has("agent")).toBe(false);
    expect(doneFrom({ ...none, agent: "claude" }).has("agent")).toBe(true);
    // FIX-4: a plain terminal is not an AI agent, so a saved "terminal" default does not tick the step.
    expect(doneFrom({ ...none, agent: "terminal" }).has("agent")).toBe(false);
    expect(doneFrom({ ...none, agent: " Terminal " }).has("agent")).toBe(false);
    expect(doneFrom({ ...none, agent: "   " }).has("agent")).toBe(false);
    expect(doneFrom({ ...none, notifications: false }).has("notifications")).toBe(false);
    expect(doneFrom({ ...none, notifications: true }).has("notifications")).toBe(true);
  });
});

describe("Explore Kolux stops need a visit (ONB-023)", () => {
  const kept = new Set<string>();
  it("a configured stop stays unticked until visited", () => {
    expect(stopDone("pr", new Set(), kept)).toBe(false);
    expect(stopDone("pr", new Set(["pr"]), kept)).toBe(true);
  });

  it("once complete a stop stays complete", () => {
    expect(stopDone("ship", new Set(), new Set([doneId("ship")]))).toBe(true);
    const review = WORKFLOWS.find((w) => w.id === "review")!;
    // Review keeps only optional stops since its line notes went with the diff view (2026-11-19).
    expect(workflowDone(review, new Set(["review"]), kept)).toBe(true);
    expect(workflowDone(review, new Set<string>(), kept)).toBe(false);
  });

  it("visits come back on reopen with unknown and repeated entries dropped, the retired stops included", () => {
    expect(visits(["tasks", "nope", "notes", "pr", "orchestration", "pr", "editor", "split-terminal"])).toEqual(["pr"]);
  });
});

describe("the saved record (ONB-015)", () => {
  it("the saved record merges into what this window already saw; an early visit is never lost (FIX-1)", () => {
    // "workspaces" was visited in this window before the record (which only knows "review") arrived.
    const r = withRecord(new Set(["workspaces"]), new Set(["explore-usage"]), { visited: ["review", "nope"], tried: ["explore-agents"] });
    expect([...r.seen].sort()).toEqual(["explore-agents", "review", "workspaces"]);
    expect([...r.kept].sort()).toEqual(["explore-agents", "explore-usage"]);
  });
});

describe("the legacy-profile rule (ONB-015)", () => {
  it("an old profile that hid the sidebar checklist, or finished the earlier steps, counts every step as complete", () => {
    expect(legacyProfile({ setupChecklist: false }, [])).toBe(true);
    expect(legacyProfile({}, [LEGACY_DONE])).toBe(true);
    expect([...doneFrom({ ...none, legacy: true })].sort()).toEqual(STEPS.map((s) => s.id).sort());
  });
  it("a profile that never hid the checklist is not legacy, and a failed read is never taken as completion", () => {
    expect(legacyProfile({ setupChecklist: true }, [])).toBe(false);
    expect(legacyProfile({}, ["repos-two"])).toBe(false);
    expect(legacyProfile(null, null)).toBeNull();
    expect(legacyProfile(null, [])).toBe(false);
    expect([...doneFrom({ ...none, legacy: null })]).toEqual([]);
    expect([...doneFrom({ ...none, legacy: false })]).toEqual([]);
  });
  it("a retired step id (the old split-terminal step) no longer counts toward progress", () => {
    const stale = new Set(["split-terminal", "browser"]) as unknown as Set<StepId>;
    expect(ring(stale).done).toBe(0);
  });
});

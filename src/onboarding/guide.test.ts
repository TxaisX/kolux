import { describe, expect, it } from "vitest";
import { caps, completed, doneFrom, doneId, firstOpen, forward, latest, legacyProfile, LEGACY_DONE, milestonesShown, moveOn, nextTip, railKey, ring, startTicked, stopDone, STEPS, stopOf, visits, withRecord, workflowDone, WORKFLOWS, type Facts, type Place, type Setup, type StepId } from "./guide";

const set = (...ids: StepId[]) => new Set<StepId>(ids);

describe("Setup Guide (ONB-014)", () => {
  it("has seven steps, the Setup group before the parallel-work group", () => {
    expect(STEPS).toHaveLength(7);
    const groups = STEPS.map((s) => s.group);
    expect(groups.lastIndexOf("setup")).toBeLessThan(groups.indexOf("parallel"));
    expect(STEPS.every((s) => s.ko.name && s.ko.about && s.en.name && s.en.about)).toBe(true);
  });

  it("opens on the first unfinished step, Setup first, or on the step asked for", () => {
    expect(firstOpen(set())).toBe("notifications");
    expect(firstOpen(set("notifications", "agent"))).toBe("cli");
    const setupDone = set(...STEPS.filter((s) => s.group === "setup").map((s) => s.id));
    expect(firstOpen(setupDone)).toBe("multitask");
    expect(firstOpen(set(), "repos")).toBe("repos");
    expect(firstOpen(set(...STEPS.map((s) => s.id)))).toBe("notifications");
  });

  it("moves on once the step showing is done", () => {
    expect(moveOn("cli", set())).toBe("cli");
    expect(moveOn("cli", set("cli"))).toBe("integrations");
    expect(moveOn("repos", set("repos"))).toBe("notifications");
    const all = set(...STEPS.map((s) => s.id));
    expect(moveOn("cli", all)).toBe("cli");
  });

  it("counts core steps in the ring and drops Milestones once they are all done", () => {
    expect(ring(set())).toEqual({ done: 0, total: 6 });
    const core = STEPS.filter((s) => s.core).map((s) => s.id);
    expect(milestonesShown(set(...core.slice(1)))).toBe(true);
    expect(milestonesShown(set(...core))).toBe(false);
  });
});

describe("CLI step (ONB-017)", () => {
  it("starts only the missing capabilities ticked", () => {
    const c = caps({ installed: true, onPath: true }, ["pdf"]);
    expect(startTicked(c)).toEqual(["kolux-cli", "orchestration"]);
    expect(startTicked(caps({ installed: true, onPath: false }, ["kolux-cli", "orchestration"]))).toEqual(["command"]);
    expect(startTicked(caps(null, []))).toEqual(["command", "kolux-cli", "orchestration"]);
  });
});

describe("Explore Kolux (ONB-022)", () => {
  it("opens on workspaces with five workflows on the rail", () => {
    expect(WORKFLOWS.map((w) => w.id)).toEqual(["workspaces", "tasks", "agents", "workbench", "review"]);
    expect(stopOf({ w: 0, s: -1 }).id).toBe("workspaces");
  });

  it("Continue visits a workflow's stops before the next workflow", () => {
    const seen: string[] = [];
    let at: ReturnType<typeof forward> = { w: 2, s: -1 };
    for (let i = 0; i < 4 && at; i++) {
      at = forward(at);
      if (at) seen.push(stopOf(at).id);
    }
    expect(seen).toEqual(["statuses", "usage", "orchestration", "workbench"]);
    expect(forward({ w: 4, s: 2 })).toBeNull();
  });

  it("the rail answers arrows, Home and End and stops at both ends", () => {
    expect(railKey("End", 0)).toBe(4);
    expect(railKey("Home", 3)).toBe(0);
    expect(railKey("ArrowDown", 4)).toBe(4);
    expect(railKey("ArrowUp", 0)).toBe(0);
    expect(railKey("a", 1)).toBeNull();
  });

  it("a workflow is Completed once it and its required stops were visited", () => {
    const agents = WORKFLOWS[2];
    expect(completed(agents, new Set(["agents"]))).toBe(false);
    expect(completed(agents, new Set(["agents", "statuses"]))).toBe(true);
  });
});

describe("startup tips (ONB-027)", () => {
  const none = { seen: [], tried: [], cli: { installed: false, onPath: false }, onboarding: false };
  it("shows the CLI tip, then the palette tip, then nothing", () => {
    expect(nextTip(none)).toBe("cli");
    expect(nextTip({ ...none, seen: ["cli"] })).toBe("palette");
    expect(nextTip({ ...none, seen: ["cli", "palette"] })).toBeNull();
  });
  it("skips the CLI tip when it is on PATH or its status cannot be read, but not when only installed", () => {
    expect(nextTip({ ...none, cli: { installed: true, onPath: true } })).toBe("palette");
    expect(nextTip({ ...none, cli: "error" })).toBe("palette");
    expect(nextTip({ ...none, cli: { installed: true, onPath: false } })).toBe("cli");
  });
  it("shows nothing in a session that showed the first run, and skips a feature already in use", () => {
    expect(nextTip({ ...none, onboarding: true })).toBeNull();
    expect(nextTip({ ...none, seen: ["cli"], tried: ["palette"] })).toBeNull();
  });
});

const none: Facts = { workspaces: null, gitProjects: null, integrations: null, cli: false, notifications: null, agent: null, setupScript: null };
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

  it("Multiple repos needs two git projects; Integrations waits while its checks are out", () => {
    expect(doneFrom({ ...none, gitProjects: 1 }).has("repos")).toBe(false);
    expect(doneFrom({ ...none, gitProjects: 2 }).has("repos")).toBe(true);
    expect(doneFrom({ ...none, integrations: "checking" }).has("integrations")).toBe(false);
    expect(doneFrom({ ...none, integrations: "none" }).has("integrations")).toBe(false);
    expect(doneFrom({ ...none, integrations: "connected" }).has("integrations")).toBe(true);
  });

  it("the default agent, notifications, CLI and setup-script steps tick from their own state", () => {
    expect(doneFrom({ ...none, agent: "" }).has("agent")).toBe(false);
    expect(doneFrom({ ...none, agent: "claude" }).has("agent")).toBe(true);
    // FIX-4: a plain terminal is not an AI agent, so a saved "terminal" default does not tick the step.
    expect(doneFrom({ ...none, agent: "terminal" }).has("agent")).toBe(false);
    expect(doneFrom({ ...none, agent: " Terminal " }).has("agent")).toBe(false);
    expect(doneFrom({ ...none, agent: "   " }).has("agent")).toBe(false);
    expect(doneFrom({ ...none, notifications: false }).has("notifications")).toBe(false);
    expect(doneFrom({ ...none, notifications: true }).has("notifications")).toBe(true);
    expect(doneFrom({ ...none, cli: true }).has("cli")).toBe(true);
    expect(doneFrom({ ...none, setupScript: false }).has("automate")).toBe(false);
    expect(doneFrom({ ...none, setupScript: true }).has("automate")).toBe(true);
  });

  it("setup-script readiness resets on new inputs and an older check's late answer is dropped", () => {
    const seen: (boolean | null)[] = [];
    const check = latest<boolean>((v) => seen.push(v));
    const first = check.begin();
    const second = check.begin();
    check.settle(first, true);
    check.settle(second, false);
    expect(seen).toEqual([null, null, false]);
  });
});

describe("Explore Kolux stops need a visit and real setup (ONB-023)", () => {
  const off: Setup = { taskSource: false, skills: [] };
  const kept = new Set<string>();
  it("a configured stop stays unticked until visited; a visited stop that needs setup waits for it", () => {
    expect(stopDone("tasks", new Set(), { ...off, taskSource: true }, kept)).toBe(false);
    expect(stopDone("tasks", new Set(["tasks"]), off, kept)).toBe(false);
    expect(stopDone("tasks", new Set(["tasks"]), { ...off, taskSource: true }, kept)).toBe(true);
    expect(stopDone("orchestration", new Set(["orchestration"]), { ...off, skills: ["kolux-cli"] }, kept)).toBe(false);
    expect(stopDone("orchestration", new Set(["orchestration"]), { ...off, skills: ["orchestration"] }, kept)).toBe(true);
    expect(stopDone("editor", new Set(["editor"]), off, kept)).toBe(true);
  });

  it("once complete a stop stays complete when detection later says unavailable", () => {
    expect(stopDone("orchestration", new Set(["orchestration"]), off, new Set([doneId("orchestration")]))).toBe(true);
    const review = WORKFLOWS.find((w) => w.id === "review")!;
    expect(workflowDone(review, new Set(["review", "notes"]), off, kept)).toBe(true);
    const tasks = WORKFLOWS.find((w) => w.id === "tasks")!;
    expect(workflowDone(tasks, new Set(["tasks"]), off, kept)).toBe(false);
  });

  it("visits come back on reopen with unknown and repeated entries dropped", () => {
    expect(visits(["tasks", "nope", "tasks", "notes", "split-terminal"])).toEqual(["tasks", "notes"]);
  });
});

describe("the saved record (ONB-015)", () => {
  it("the saved record merges into what this window already saw; an early visit is never lost (FIX-1)", () => {
    // "workspaces" was visited in this window before the record (which only knows "tasks") arrived.
    const r = withRecord(new Set(["workspaces"]), new Set(["explore-usage"]), { visited: ["tasks", "nope"], tried: ["explore-agents"] });
    expect([...r.seen].sort()).toEqual(["explore-agents", "tasks", "workspaces"]);
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

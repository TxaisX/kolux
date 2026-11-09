import { describe, expect, it } from "vitest";
import { Beat, FRAMES, holdsDetails, needsBeat, saysActionNeeded, statusTitle, type TitleInput } from "./tabNameRule";

const base: TitleInput = { shown: "Codex", named: false, agent: "codex", name: "Codex", live: null, state: undefined, frame: "⠋" };

describe("STAT-035 tab-name rule", () => {
  it("leaves a tab alone until a hook reports, and never touches a typed name", () => {
    expect(statusTitle(base)).toBe("Codex");
    expect(statusTitle({ ...base, state: "done", named: true, shown: "my tab" })).toBe("my tab");
    expect(statusTitle({ ...base, agent: null, state: "done", shown: "Terminal 3" })).toBe("Terminal 3");
  });

  it("writes ready and action required for agents whose titles do not show state", () => {
    expect(statusTitle({ ...base, state: "permission" })).toBe("Codex action required");
    expect(statusTitle({ ...base, state: "waiting" })).toBe("Codex action required");
    expect(statusTitle({ ...base, state: "done" })).toBe("Codex ready");
    expect(statusTitle({ ...base, agent: "devin", name: "Devin", state: "idle" })).toBe("Devin ready");
    expect(statusTitle({ ...base, agent: "omp", name: "OMP", state: "blocked" })).toBe("OMP action required");
  });

  it("renames any agent's stale action-needed title once it is done", () => {
    const claude = { ...base, agent: "claude", name: "Claude" };
    expect(statusTitle({ ...claude, state: "done", shown: "Claude: permission required" })).toBe("Claude ready");
    expect(statusTitle({ ...claude, state: "done", shown: "✳ Fix login" })).toBe("✳ Fix login");
    expect(statusTitle({ ...claude, state: "permission", shown: "✳ Fix login" })).toBe("✳ Fix login");
  });

  it("animates a working spinner only when the agent's own title has neither a spinner nor details", () => {
    const pi = { ...base, agent: "pi", name: "Pi", state: "working" as const, shown: "Pi" };
    expect(statusTitle({ ...pi, live: null })).toBe("⠋ Pi");
    expect(statusTitle({ ...pi, live: "pi" })).toBe("⠋ Pi");
    expect(statusTitle({ ...pi, live: "⠹ pi working", shown: "⠹ pi working" })).toBe("⠹ pi working");
    expect(statusTitle({ ...pi, live: "pi - refactor parser", shown: "pi - refactor parser" })).toBe("pi - refactor parser");
    // Codex's own working title shows it is busy: no Kolux spinner.
    expect(statusTitle({ ...base, state: "working", shown: "codex" })).toBe("codex");
    expect(needsBeat({ named: false, agent: "pi", name: "Pi", live: null, state: "working" })).toBe(true);
    expect(needsBeat({ named: false, agent: "codex", name: "Codex", live: null, state: "working" })).toBe(false);
    expect(needsBeat({ named: false, agent: "pi", name: "Pi", live: null, state: "done" })).toBe(false);
  });

  it("reads action-needed and details words", () => {
    expect(saysActionNeeded("Needs your approval")).toBe(true);
    expect(saysActionNeeded("waiting for input")).toBe(true);
    expect(saysActionNeeded("Fix the permission tests")).toBe(false);
    expect(holdsDetails("Devin", "Devin")).toBe(false);
    expect(holdsDetails("» devin «", "Devin")).toBe(false);
    expect(holdsDetails("devin: session 4", "Devin")).toBe(true);
  });
});

describe("STAT-035 shared beat", () => {
  const fake = () => {
    const live = new Set<() => void>();
    return {
      live,
      timers: { every: (fn: () => void) => (live.add(fn), fn), stop: (h: unknown) => void live.delete(h as () => void) },
      fire: () => live.forEach((fn) => fn()),
    };
  };

  it("runs one timer for every pane, hands all of them the same frame, and stops when the last leaves", () => {
    const t = fake();
    const beat = new Beat(() => false, t.timers);
    const seen: Record<number, string[]> = { 1: [], 2: [] };
    const off1 = beat.join(1, (f) => seen[1].push(f));
    beat.join(2, (f) => seen[2].push(f));
    expect(t.live.size).toBe(1);
    t.fire();
    t.fire();
    expect(seen[1]).toEqual([FRAMES[1], FRAMES[2]]);
    expect(seen[2]).toEqual(seen[1]);
    off1();
    t.fire();
    expect(seen[1]).toHaveLength(2);
    beat.leave(2);
    expect(beat.running).toBe(false);
    expect(t.live.size).toBe(0);
  });

  it("skips decorative frames while the window is hidden", () => {
    const t = fake();
    let hidden = true;
    const beat = new Beat(() => hidden, t.timers);
    const seen: string[] = [];
    beat.join(7, (f) => seen.push(f));
    t.fire();
    expect(seen).toEqual([]);
    hidden = false;
    t.fire();
    expect(seen).toEqual([FRAMES[1]]);
  });

  it("hands frames to readers of the frame (the tab labels), not to the window: joining runs the timer, watching does not", () => {
    const t = fake();
    const beat = new Beat(() => false, t.timers);
    let labelRenders = 0;
    const unwatch = beat.watch(() => labelRenders++);
    expect(t.live.size).toBe(0); // a reader alone starts no timer
    const off = beat.join(3, () => {}); // useBeatKeys: the window joins without re-rendering itself
    t.fire();
    t.fire();
    expect(labelRenders).toBe(2);
    expect(beat.snapshot()).toBe(FRAMES[2]);
    unwatch();
    t.fire();
    expect(labelRenders).toBe(2);
    off();
    expect(beat.running).toBe(false);
  });
});

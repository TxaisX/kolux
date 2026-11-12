// @ts-expect-error vitest runs on Node; the app's browser tsconfig has no Node types.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { classify, markShell, readRemove, removePlan, removeQuestion, runningOf } from "./remove";
import { askKey } from "../chrome/Ask";

describe("TERM-003 remove a started session", () => {
  it("classifies panes before deciding", () => {
    expect(classify({ agent: "shell", seats: [{}] }, false)).toBe("unstarted");
    expect(classify({ agent: "claude" }, false)).toBe("agent");
    expect(classify({ agent: "shell" }, true)).toBe("shell");
    expect(classify({ agent: "shell" }, false)).toBe("idle");
  });

  it("T-151-c: an agent pane whose program has ended is \"ended\", never an agent that is still running", () => {
    expect(classify({ agent: "claude" }, false, false)).toBe("ended");
    expect(classify({ agent: "codex" }, true, false)).toBe("ended"); // busy is about a shell's children: an ended agent has none to stop
    expect(classify({ agent: "claude" }, false, true)).toBe("agent");
    expect(classify({ agent: "claude" }, false, undefined)).toBe("agent");
    expect(classify({ agent: "claude", seats: [{}] }, false, false)).toBe("unstarted");
    expect(classify({ agent: "shell" }, false, false)).toBe("idle");
    expect(classify({ agent: "shell" }, true, false)).toBe("shell");
    expect(removePlan({}, "ended")).toBe("remove");
    expect(removePlan({ removeStartedSession: "stop" }, "ended")).toBe("remove");
  });

  it("FIX-1: an agent pane still starting (running not reported yet) is asked about, never dropped as ended", () => {
    for (const agent of ["claude", "codex"]) {
      const kind = classify({ agent }, false, undefined);
      expect(kind).toBe("agent");
      expect(removePlan({}, kind)).toBe("ask");
      expect(removePlan({ removeStartedSession: "stop" }, kind)).toBe("stop");
    }
  });

  it("FIX-1: an ended agent pane that started a shell is classified by that shell, with the shell's question", () => {
    expect(classify({ agent: "claude" }, false, true, true)).toBe("idle"); // nothing running in the shell: goes at once
    const kind = classify({ agent: "claude" }, true, true, true);
    expect(kind).toBe("shell");
    expect(removePlan({}, kind)).toBe("ask");
    expect(removeQuestion("claude 1", kind).body).toMatch(/still running in this shell/);
    expect(classify({ agent: "claude" }, true, false, true)).toBe("shell"); // a busy shell is never dropped as ended
  });

  it("FIX-2: the pane's running report is undefined while starting, true while it runs, false once ended or failed; starting still gets the question", () => {
    expect(runningOf("starting")).toBeUndefined();
    expect(runningOf("running")).toBe(true);
    expect(runningOf("ended")).toBe(false);
    expect(runningOf("failed")).toBe(false);
    for (const agent of ["claude", "codex"]) {
      const kind = classify({ agent }, false, runningOf("starting"));
      expect(kind).toBe("agent");
      expect(removePlan({}, kind)).toBe("ask");
      expect(removePlan({ removeStartedSession: "stop" }, kind)).toBe("stop");
    }
    expect(classify({ agent: "claude" }, false, runningOf("running"))).toBe("agent");
    expect(classify({ agent: "claude" }, false, runningOf("ended"))).toBe("ended");
    expect(classify({ agent: "claude" }, false, runningOf("failed"))).toBe("ended");
  });

  it("FIX-2: markShell wires the set: an agent pane that starts a shell is added, a real restart or a shell pane removes it, no key does nothing", () => {
    const set = new Set<number>();
    markShell(set, 7, true, "claude");
    expect(set.has(7)).toBe(true);
    markShell(set, 7, false, "claude"); // a real restart of the agent: no longer a shell
    expect(set.has(7)).toBe(false);
    markShell(set, 8, true, "shell"); // a shell pane restarting as a shell is just a shell pane
    expect(set.has(8)).toBe(false);
    set.add(9);
    markShell(set, 9, true, "shell");
    expect(set.has(9)).toBe(false);
    markShell(set, undefined, true, "claude"); // a pane with no key cannot be tracked
    expect(set.size).toBe(0);
  });

  it("removes unstarted panes and idle shells without a prompt, asks for started sessions by default", () => {
    expect(removePlan({}, "unstarted")).toBe("remove");
    expect(removePlan({}, "idle")).toBe("remove");
    expect(removePlan({}, "agent")).toBe("ask");
    expect(removePlan({}, "shell")).toBe("ask");
  });

  it("with the default set to stop, removing a started session stops it without a dialog", () => {
    expect(readRemove({ removeStartedSession: "stop" })).toBe("stop");
    expect(removePlan({ removeStartedSession: "stop" }, "agent")).toBe("stop");
    expect(removePlan({ removeStartedSession: "stop" }, "unstarted")).toBe("remove");
    // "sleep" has no per-session sleep to land on yet: it reads as ask
    expect(readRemove({ removeStartedSession: "sleep" })).toBe("ask");
  });

  it("the question names the session; Enter pressed at once (Cancel focused, not Confirm) does not confirm", () => {
    expect(removeQuestion("claude 1", "agent")).toEqual({ title: "Stop “claude 1”?", body: "Its agent is still running. Removing the pane stops it." });
    expect(removeQuestion("shell", "shell").body).toMatch(/still running in this shell/);
    // VIEW-116's dialog gives Cancel focus on open; Enter there is "pass" (does what Cancel does), never confirms
    expect(askKey("Enter", false, true)).toBe("pass");
    expect(askKey("Enter", true, false)).toBe("block");
  });
});

// o1-tools N-44: the setting had no reader on the live path; the remove shortcut now consults removePlan before asking.
it("the remove shortcut stops without asking when the setting says so", async () => {
  const src = readFileSync(new URL("./paneActions.ts", import.meta.url), "utf8");
  const body = src.slice(src.indexOf("const removeSession = async"), src.indexOf("// TERM-040 / TERM-041"));
  expect(body).toMatch(/removePlan\(settings, kind\) === "stop"\) return dropPanes\(\[t\.key\]\)/);
  expect(body.indexOf("removePlan(")).toBeLessThan(body.indexOf("setAsking("));
  expect(removePlan({ removeStartedSession: "stop" }, "agent")).toBe("stop");
  expect(removePlan({}, "agent")).toBe("ask");
});

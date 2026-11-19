import { describe, expect, it } from "vitest";
import { HOOKS_OFF_HELP } from "../launch/KeepAwakeCard";
import { awakeToggle, stopCard, writerBack } from "./stopCards";

describe("Explore Kolux stops carry their own setup cards (ONB-024)", () => {
  const f = (settings: Record<string, unknown> | null = {}, taskSource: boolean | null = false) => ({ taskSource, settings });
  it("PR view shows GitHub, connected or not, and says so while it is still being read", () => {
    expect(stopCard("pr", f({}, true))).toEqual({ kind: "provider", connected: true, label: "Pull requests come from GitHub" });
    expect(stopCard("pr", f({}, false))).toEqual({ kind: "provider", connected: false, label: "Pull requests come from GitHub" });
    expect(stopCard("pr", f({}, null))).toMatchObject({ kind: "provider", connected: null });
    // The Tasks stop went with its screen (2026-11-19).
    expect(stopCard("tasks", f({}, true))).toBeNull();
  });
  it("agent statuses: keep-awake off turns on the automatic mode, and either on mode can be switched off", () => {
    expect(stopCard("statuses", f({ keepAwake: "off" }))).toMatchObject({ kind: "awake", mode: "off", on: false });
    expect(awakeToggle("off")).toBe("agent");
    expect(awakeToggle("agent")).toBe("off");
    expect(awakeToggle("on")).toBe("off");
    expect(stopCard("statuses", f({ keepAwake: "on" }))).toMatchObject({ mode: "on", on: true });
  });
  it("the settings cards wait for the settings: no switch is drawn from guessed defaults (FIX-1)", () => {
    expect(stopCard("statuses", f(null))).toBeNull();
    expect(stopCard("ship", f(null))).toBeNull();
    // a stop that needs no setting still draws
    expect(stopCard("pr", f(null, true))).toMatchObject({ kind: "provider", connected: true });
  });
  it("keep-awake in Agent mode says so when the status hooks are off, as the Settings page does (FIX-1)", () => {
    expect(stopCard("statuses", f({ keepAwake: "agent" }))).toMatchObject({ mode: "agent", hooksOff: true });
    expect(stopCard("statuses", f({ keepAwake: "agent", agentStatusHooks: true }))).toMatchObject({ hooksOff: false });
    expect(stopCard("statuses", f({ keepAwake: "on" }))).toMatchObject({ hooksOff: false });
    expect(stopCard("statuses", f({ keepAwake: "off" }))).toMatchObject({ hooksOff: false });
    expect(HOOKS_OFF_HELP).toMatch(/needs "Show what each agent is doing"/);
  });
  it("ship shows the commit message writer settings", () => {
    expect(stopCard("ship", f({}))).toMatchObject({ kind: "writer", writer: { mode: "agent", agent: "claude" }, hasCommand: false });
    expect(stopCard("ship", f({ commitWriter: "off" }))).toMatchObject({ writer: { mode: "off" } });
    expect(stopCard("ship", f({ commitWriter: "custom", commitWriterCommand: " my-writer " }))).toMatchObject({ writer: { mode: "custom" }, hasCommand: true });
  });
  it("switching the writer back on restores the earlier mode: custom stays custom, a custom with no command falls to Claude (FIX-1)", () => {
    expect(writerBack("custom", true)).toBe("custom");
    expect(writerBack("claude", true)).toBe("claude");
    expect(writerBack("codex", false)).toBe("codex");
    expect(writerBack("custom", false)).toBe("claude");
    // nothing remembered (the card opened already off): a saved command means the user had picked custom
    expect(writerBack(null, true)).toBe("custom");
    expect(writerBack(null, false)).toBe("claude");
  });
  it("stops with no setup card draw nothing; usage has its own (T-321-c)", () => {
    for (const id of ["terminal", "workspaces", "orchestration"]) expect(stopCard(id, f())).toBeNull();
    expect(stopCard("usage", f())).not.toBeNull();
  });
});

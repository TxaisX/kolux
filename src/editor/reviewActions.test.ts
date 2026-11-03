// What the review actions say when they cannot do what was asked (UX audit, lane D): an answer the agent never got,
// and an Approve or Request changes pressed after the agent has moved on from the plan.
import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));

import { PLAN_STALE, answerFailed, reviewActions } from "./reviewActions";

const PLAN = "1. do the thing";
const pane = { key: 7, agent: "claude", cwd: "C:/w" } as never;

function setup(state: string | undefined) {
  const setToast = vi.fn();
  const setReviewing = vi.fn();
  const s = {
    activeDir: "C:/w", agents: [], focused: 7, notes: [], panes: [],
    hookRef: { current: { 7: state } }, ptys: { current: {} }, planDrafts: {}, titles: {},
    turn: { 7: { tool: "ExitPlanMode", plan: PLAN } },
    setHook: vi.fn(), setNotes: vi.fn(), setPlanDrafts: vi.fn(), setReviewing, setStamp: vi.fn(), setToast,
  };
  const a = reviewActions(s as never, { notesFor: () => [], saveNotes: vi.fn() } as never, { openIn: vi.fn() } as never, { panesRef: { current: [] } } as never);
  return { a, setToast, setReviewing };
}

// Braces: a beforeEach that returns the mock would be run by vitest as its cleanup hook.
beforeEach(() => {
  invoke.mockReset();
});

describe("approve and deny errors are shown", () => {
  it("a failed answer toasts the reason and points at the terminal", async () => {
    invoke.mockRejectedValue(new Error("pipe closed"));
    const { a, setToast } = setup("permission");
    await a.answer(pane, true);
    expect(setToast).toHaveBeenCalledWith(answerFailed(new Error("pipe closed")));
    expect(setToast.mock.calls[0][0]).toContain("pipe closed");
    expect(setToast.mock.calls[0][0]).toContain("terminal");
  });
  it("a string error is shown as it is, and a good answer says nothing", async () => {
    expect(answerFailed("gone")).toContain("gone");
    invoke.mockResolvedValue("working");
    const { a, setToast } = setup("permission");
    await a.answer(pane, true);
    expect(setToast).not.toHaveBeenCalled();
  });
});

describe("a stale plan is said, not ignored", () => {
  it("Approve toasts and sends nothing when the pane no longer waits on the plan", () => {
    const { a, setToast, setReviewing } = setup("working");
    a.approvePlan(pane, PLAN);
    expect(setToast).toHaveBeenCalledWith(PLAN_STALE);
    expect(invoke).not.toHaveBeenCalled();
    expect(setReviewing).not.toHaveBeenCalled();
  });
  it("Request changes toasts the same", async () => {
    const { a, setToast } = setup("idle");
    await a.requestChanges(pane, PLAN);
    expect(setToast).toHaveBeenCalledWith(PLAN_STALE);
    expect(invoke).not.toHaveBeenCalled();
  });
  it("a live plan still goes through without a toast", () => {
    invoke.mockResolvedValue("working");
    const { a, setToast, setReviewing } = setup("permission");
    a.approvePlan(pane, PLAN);
    expect(setToast).not.toHaveBeenCalled();
    expect(setReviewing).toHaveBeenCalledWith(null);
    expect(invoke).toHaveBeenCalledWith("agent_answer", { paneKey: 7, agent: "claude", approve: true });
  });
});

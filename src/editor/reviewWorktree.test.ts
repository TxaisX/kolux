// P2-A: review notes and their agents follow the worktree the focused pane works in (workDir), not the project's grid
// folder (activeDir), which with one workspace per project is always the main checkout.
import { expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { reviewActions } from "./reviewActions";

const ROOT = "G:/Dev/kolux";
const WT = "G:/Dev/kolux-lanes/one-ws";

function setup() {
  const openIn = vi.fn().mockResolvedValue(1);
  const panes = [
    { key: 1, agent: "claude", cwd: ROOT, branch: "main" },
    { key: 2, agent: "claude", cwd: WT, branch: "feat/one-workspace" },
    { key: 3, agent: "shell", cwd: WT, branch: "feat/one-workspace" },
  ];
  const s = {
    activeDir: ROOT, workDir: WT, agents: [{ id: "claude", name: "Claude", installed: true }], focused: 2, notes: [], panes,
    hookRef: { current: {} }, ptys: { current: { 1: 11, 2: 22, 3: 33 } }, planDrafts: {}, titles: {},
    turn: {}, setHook: vi.fn(), setNotes: vi.fn(), setPlanDrafts: vi.fn(), setReviewing: vi.fn(), setStamp: vi.fn(), setToast: vi.fn(),
  };
  const a = reviewActions(s as never, { notesFor: () => [], saveNotes: vi.fn() } as never, { openIn } as never, { panesRef: { current: panes } } as never);
  return { a, openIn, panes };
}

it("the agents the notes can go to are the ones in the focused pane's worktree, not the main checkout's", () => {
  const { a, panes } = setup();
  expect(a.inWorktree(panes[1] as never)).toBe(true);
  expect(a.inWorktree(panes[0] as never)).toBe(false);
});

it("a review agent started from the Send menu runs in that worktree, on its branch", async () => {
  const { a, openIn } = setup();
  const said = await a.startReview("claude");
  expect(said).toContain("Started");
  expect(openIn).toHaveBeenCalledWith(expect.objectContaining({ id: "claude" }), WT, "feat/one-workspace", expect.any(String), true);
});

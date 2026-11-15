import dialogsSrc from "./Dialogs.tsx?raw";
import { describe, expect, it } from "vitest";
import { paletteAt } from "./paletteAt";
import { setGridRoots } from "../../workspaces";
import type { AgentState, RowInfo } from "../../projects/rows";

// F27: one grid per project. A worktree's panes are shown in the project's grid (rowStates and the unread
// dots are keyed by that grid), but the palette lists the worktree as its own row.
const PROJECT = "C:/w/app";
const TREE = "C:/Users/me/.kolux/workspaces/app/feat";
type P = { key: number; cwd: string; agent: string; seats?: unknown };
const panes: P[] = [
  { key: 1, cwd: PROJECT, agent: "claude" },
  { key: 2, cwd: TREE, agent: "claude" },
];
setGridRoots({ [TREE]: PROJECT }, [PROJECT]);
const grid: Record<string, RowInfo> = { [PROJECT]: { state: "permission", changed: 5, pr: null } };

function at(d: string, hook: Record<number, AgentState>, opts: { unread?: number[]; turn?: Record<number, { monitoring?: boolean }> } = {}) {
  return paletteAt(d, panes, (p) => hook[p.key], { 1: true, 2: true }, new Set(opts.unread ?? []), hook, opts.turn ?? {}, grid);
}

describe("paletteAt (F27)", () => {
  it("a worktree row shows its own pane's state", () => {
    expect(at(TREE, { 1: "done", 2: "permission" })?.mark).toBe("permission");
  });

  it("the project row does not take the worktree pane's state", () => {
    expect(at(PROJECT, { 1: "done", 2: "permission" })?.mark).toBe("done");
  });

  it("a worktree row shows its own unread pane, and the project row does not", () => {
    expect(at(TREE, { 1: "done", 2: "idle" }, { unread: [2] })?.mark).toBe("unread");
    expect(at(PROJECT, { 1: "idle", 2: "idle" }, { unread: [2] })).toBeNull();
  });

  it("the background mark follows the row's own working panes", () => {
    const turn = { 1: { monitoring: true }, 2: { monitoring: false } };
    expect(at(PROJECT, { 1: "working", 2: "working" }, { turn })?.mark).toBe("background");
    expect(at(TREE, { 1: "working", 2: "working" }, { turn })?.mark).toBe("working");
  });

  it("keeps the grid row's age only while it says the same thing", () => {
    expect(at(PROJECT, { 1: "permission", 2: "idle" })).toEqual({ mark: "permission", since: 5 });
    expect(at(TREE, { 1: "idle", 2: "permission" })).toEqual({ mark: "permission", since: 0 });
  });

  it("an empty folder has no mark", () => {
    expect(at("C:/w/other", { 1: "permission", 2: "permission" })).toBeNull();
  });

  it("the palette in Dialogs uses it", () => {
    const src = dialogsSrc;
    expect(src).toContain("atOf={(d) => paletteAt(");
    expect(src).not.toMatch(/sameDir\(viewOf\(p\), d\)/);
  });
});

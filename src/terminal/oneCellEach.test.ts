// One session per cell (owner decision 2026-11-12, PR #255): a layout saved while a grid cell could hold several tabs
// reopens with each tab in a cell of its own (layout.ts oneCellEach, run by restoreLayout). Nothing a user saved is
// lost: every tab comes back, with its title, session, pin and colour, even when the grid grows past MAX_PANES.
import { expect, test } from "vitest";
import { panesIn } from "../workspaces";
import { cellsOf, MAX_PANES } from "./grid";
import { freshShells, layoutOf, oneCellEach, restoreLayout, reviveSaved, stillThere, type SavedPane } from "./layout";

const tab = (key: number, extra: Partial<SavedPane> = {}): SavedPane => ({ key, cwd: "C:\\w\\app", branch: "main", agent: "shell", program: null, args: [], ...extra });

/** A layout exactly as Kolux wrote it before this change: tabs share a cell through `group`, and `activeTab` names the
 *  tab each cell showed in front. */
const OLD = {
  panes: [
    tab(1),
    tab(2, { agent: "claude", agentId: "claude", program: "claude", session: "s-2", title: "Fix login", group: 2 }),
    tab(3),
    tab(4, { kind: "editor", path: "C:\\w\\app\\README.md", group: 2 }),
    tab(5, { agent: "codex", agentId: "codex", program: "codex", session: "thr-5", group: 2, pinned: true, color: "teal" }),
    tab(6, { group: 3, title: "server" }),
  ],
  activeTab: { 1: 1, 2: 4, 3: 6 },
  focused: 4,
  activeDir: "C:\\w\\app",
  stacked: {},
};

test("an old cell of three tabs reopens as three cells, in the order its strip drew them, where the cell was", () => {
  const l = restoreLayout(JSON.parse(JSON.stringify(OLD)))!;
  // Cells before: [1], [2, 4, 5] (5 pinned, so the strip drew 5, 2, 4), [3, 6]. After: one pane each, the old cell's tabs
  // taking the cells right after the cell's place, the cells around them in their order.
  expect(l.panes.map((p) => p.key)).toEqual([1, 5, 2, 4, 3, 6]);
  const grid = cellsOf(panesIn(l.panes, "C:\\w\\app"));
  expect(grid).toHaveLength(6);
  expect(grid.every((c) => c.panes.length === 1)).toBe(true);
});

test("nothing is lost: every tab comes back with its title, session, kind, pin and colour, and no cell id", () => {
  const l = restoreLayout(JSON.parse(JSON.stringify(OLD)))!;
  expect(l.panes).toHaveLength(OLD.panes.length);
  const byKey = new Map(l.panes.map((p) => [p.key, p]));
  for (const was of OLD.panes) {
    const { group: _cell, ...rest } = was;
    expect(byKey.get(was.key)).toEqual(rest);
  }
  expect(l.panes.some((p) => p.group !== undefined)).toBe(false);
  // The focus stays on the tab that had it; which tab a cell showed in front no longer matters (all are in view).
  expect(l.focused).toBe(4);
  expect(l).not.toHaveProperty("activeTab");
});

test("the grid grows past its cap rather than drop a tab: twelve cells of three tabs reopen as thirty-six cells", () => {
  const panes: SavedPane[] = [];
  for (let c = 0; c < 12; c++) for (let t = 0; t < 3; t++) panes.push(tab(100 + c * 3 + t, { group: 100 + c * 3, title: `cell ${c} tab ${t}` }));
  const l = restoreLayout({ panes, focused: 100, activeDir: "C:\\w\\app", stacked: {} })!;
  expect(l.panes).toHaveLength(36);
  expect(36).toBeGreaterThan(MAX_PANES);
  expect(cellsOf(panesIn(l.panes, "C:\\w\\app"))).toHaveLength(36);
  expect(l.panes.map((p) => p.title)).toEqual(panes.map((p) => p.title));
});

test("a tab shown in another folder's grid (DT-C274) stays in the grid its cell was shown in", () => {
  const team = "C:\\w\\app";
  const panes: SavedPane[] = [
    tab(1, { cwd: "C:\\w\\app-wt-1", view: team, agent: "claude", agentId: "claude", program: "claude" }),
    tab(2, { cwd: "C:\\w\\app-wt-1", group: 1 }), // a shell tab of that cell, saved without a view of its own
  ];
  const [agent, shell] = oneCellEach(panes);
  expect(agent.view).toBe(team);
  expect(shell).toMatchObject({ key: 2, cwd: "C:\\w\\app-wt-1", view: team });
  expect(shell).not.toHaveProperty("group");
  expect(cellsOf(panesIn([agent, shell], team)).map((c) => c.group)).toEqual([1, 2]);
});

test("tabs of different workspaces keep their own grids, and a layout with no cell ids comes back as it was saved", () => {
  const panes: SavedPane[] = [tab(1), tab(2, { cwd: "C:\\w\\other" }), tab(3, { group: 1 }), tab(4, { cwd: "C:\\w\\other", group: 2 })];
  const out = oneCellEach(panes);
  expect(out.map((p) => p.key)).toEqual([1, 3, 2, 4]);
  expect(panesIn(out, "C:\\w\\app").map((p) => p.key)).toEqual([1, 3]);
  expect(panesIn(out, "C:\\w\\other").map((p) => p.key)).toEqual([2, 4]);
  const plain = [tab(1), tab(2), tab(3)];
  expect(oneCellEach(plain)).toEqual(plain);
});

test("the whole start path keeps every tab: restore, folders still there, fresh shells, then the window's panes", () => {
  const l = freshShells(stillThere(restoreLayout(JSON.parse(JSON.stringify(OLD)))!, () => true));
  const live = l.panes.map(reviveSaved);
  expect(live.map((p) => p.key)).toEqual([1, 5, 2, 4, 3, 6]);
  // DT-C27: the agents come back as plain shells in their folder, each still in a cell of its own.
  expect(live.find((p) => p.key === 5)).toMatchObject({ agent: "shell", program: null, pinned: true, color: "teal" });
  expect(cellsOf(panesIn(live, "C:\\w\\app"))).toHaveLength(6);
});

test("the next write is in the new form: no cell ids, no tab in front, and reading it again changes nothing", () => {
  const l = restoreLayout(JSON.parse(JSON.stringify(OLD)))!;
  const written = layoutOf(l.panes, l.focused, l.activeDir, l.stacked);
  expect(JSON.stringify(written)).not.toMatch(/"group"|"activeTab"/);
  expect(restoreLayout(JSON.parse(JSON.stringify(written)))).toEqual(written);
});

import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { expect, test } from "vitest";
import { buildLanes, dragSet, droppedPaths, escapeAction, FRESH_QUERY, LANE_GAP, LANE_MAX, LANE_MIN, laneLeft, laneRange, laneWidth, listFailure, matches, moveFailure, nearestLane, pick, selectLane, windowRange, type BoardCard, type Status } from "./boardModel";
import WorkspaceBoardView from "./WorkspaceBoard";

const card = (n: number, status = "todo", project = "alpha"): BoardCard => ({ path: `C:/w/${project}/${n}`, project, projectId: project, label: `work ${n}`, branch: `feat/${n}`, status, isMain: false });
const statuses = (n: number): Status[] => Array.from({ length: n }, (_, i) => ({ id: `s${i}`, label: `Status ${i}` }));

test("PROJ-085: a lane for each status holds its workspaces; an unknown status falls into the first lane", () => {
  const lanes = buildLanes(
    [{ id: "todo", label: "To do" }, { id: "review", label: "In review" }],
    [card(1, "todo"), card(2, "review"), card(3, "gone")],
    "",
  );
  expect(lanes.map((l) => [l.status.id, l.cards.map((c) => c.label)])).toEqual([["todo", ["work 1", "work 3"]], ["review", ["work 2"]]]);
});

test("PROJ-085: the search filters every lane where it stands and never removes a lane", () => {
  const all = [card(1, "todo"), card(2, "review"), card(30, "review")];
  const st = [{ id: "todo", label: "To do" }, { id: "review", label: "In review" }];
  const lanes = buildLanes(st, all, "WORK 3");
  expect(lanes.map((l) => l.cards.length)).toEqual([0, 1]);
  expect(buildLanes(st, all, "feat/1").flatMap((l) => l.cards.map((c) => c.label))).toEqual(["work 1"]);
  expect(matches(card(1, "todo", "Zeta"), "zet")).toBe(true);
  expect(matches(card(1), "   ")).toBe(true);
});

test("VIEW-027: a workflow with 21 statuses keeps all 21 lanes, empty ones included", () => {
  const lanes = buildLanes(statuses(21), [card(1, "s20")], "");
  expect(lanes).toHaveLength(21);
  expect(lanes[20].cards).toHaveLength(1);
  expect(buildLanes(statuses(21), [card(1)], "nothing matches")).toHaveLength(21);
});

test("PROJ-085: lane widths stay between the limits and a drop in a gap goes to the nearest lane", () => {
  expect(laneWidth(5000, 2)).toBe(LANE_MAX);
  expect(laneWidth(600, 21)).toBe(LANE_MIN);
  expect(laneWidth(1000, 4)).toBeGreaterThanOrEqual(LANE_MIN);
  expect(laneWidth(1000, 4)).toBeLessThanOrEqual(LANE_MAX);
  const w = 250;
  const gapAfter0 = laneLeft(0, w) + w + LANE_GAP / 2;
  expect(nearestLane(laneLeft(0, w) + w + 1, 3, w)).toBe(0);
  expect(nearestLane(laneLeft(1, w) - 1, 3, w)).toBe(1);
  expect(nearestLane(gapAfter0, 3, w)).toBeLessThan(2);
  expect(nearestLane(-50, 3, w)).toBe(0);
  expect(nearestLane(99999, 3, w)).toBe(2);
  expect(nearestLane(10, 0, w)).toBe(-1);
});

test("VIEW-027: with hundreds of cards only the ones near the visible area are drawn", () => {
  const [a, b] = windowRange(6400, 400, 64, 800);
  expect(b - a).toBeLessThan(20);
  expect(a).toBeLessThanOrEqual(100);
  expect(b).toBeGreaterThanOrEqual(106);
  expect(windowRange(0, 400, 64, 3)).toEqual([0, 3]);
  expect(windowRange(0, 400, 64, 0)).toEqual([0, 0]);
  const [l0, l1] = laneRange(0, 1000, 260, 21);
  expect(l1 - l0).toBeLessThan(21);
  expect(laneRange(10000, 1000, 260, 21)[1]).toBe(21);
});

test("PROJ-085: Escape leaves the board open while a popover is open, and the search starts empty", () => {
  expect(escapeAction(true)).toBe("close-popover");
  expect(escapeAction(false)).toBe("close-board");
  expect(FRESH_QUERY).toBe("");
  // a freshly mounted board (what reopening does) shows an empty search box
  const html = renderToString(createElement(WorkspaceBoardView, { onClose: () => {} }));
  expect(html).toContain('value=""');
});

test("VIEW-027: a lane header selects every card in the lane; dragging a selected card carries the selection", () => {
  const lane = buildLanes(statuses(1), Array.from({ length: 300 }, (_, i) => card(i, "s0")), "")[0];
  const sel = selectLane(lane);
  expect(sel.size).toBe(300);
  expect(dragSet(sel, lane.cards[5].path)).toHaveLength(300);
  expect(dragSet(new Set(), "x")).toEqual(["x"]);
  expect([...pick(new Set(["a"]), "b", false)]).toEqual(["b"]);
  expect([...pick(new Set(["a"]), "b", true)]).toEqual(["a", "b"]);
  expect([...pick(new Set(["a", "b"]), "b", true)]).toEqual(["a"]);
});

test("PROJ-085: a row dragged from the sidebar can be dropped on a lane; junk is ignored", () => {
  expect(droppedPaths(JSON.stringify(["C:/w/a", "C:/w/b"]))).toEqual(["C:/w/a", "C:/w/b"]);
  expect(droppedPaths("not json")).toEqual([]);
  expect(droppedPaths(JSON.stringify({ a: 1 }))).toEqual([]);
  expect(droppedPaths(null)).toEqual([]);
});

test("a refused move says the cards went back", () => {
  expect(moveFailure(1, "disk full")).toBe("The move did not go through, so that workspace was put back where it came from. disk full");
  expect(moveFailure(3, "x")).toContain("those 3 workspaces were put back where they came from");
});

test("names the projects whose workspaces could not be listed", () => {
  expect(listFailure([])).toBeNull();
  expect(listFailure(["api"])).toBe("Could not list the workspaces of api, so their cards are missing here.");
  expect(listFailure(["a", "b", "c", "d", "e"])).toContain("a, b, c, and 2 more");
});

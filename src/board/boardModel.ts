// T-142 (PROJ-085, VIEW-027): the workspace board. One lane per status, each holding its workspaces.
// This file is the pure part: sorting workspaces into lanes, the search, the lane widths, where a
// drop in a gap lands, and which lanes and cards are near the visible area (only those are drawn).

export type Status = { id: string; label: string };

/** One workspace as the board shows it. */
export type BoardCard = { path: string; project: string; projectId: string; label: string; branch: string | null; status: string; isMain: boolean };

export type BoardLane = { status: Status; cards: BoardCard[] };

/** PROJ-085: the board's search matches a card's name, branch or project, case-blind, in every lane at once. */
export function matches(card: BoardCard, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [card.label, card.branch ?? "", card.project].some((s) => s.toLowerCase().includes(q));
}

/**
 * A lane for every status, in the user's order, even an empty one (VIEW-027: a workflow with 21
 * statuses keeps all 21). A card whose status is not in the list falls into the first lane. The
 * search narrows every lane where it stands; it never removes a lane.
 */
export function buildLanes(statuses: Status[], cards: BoardCard[], query: string): BoardLane[] {
  const lanes: BoardLane[] = statuses.map((status) => ({ status, cards: [] }));
  const byId = new Map(lanes.map((l) => [l.status.id, l]));
  for (const c of cards) {
    if (!matches(c, query)) continue;
    (byId.get(c.status) ?? lanes[0])?.cards.push(c);
  }
  for (const l of lanes) l.cards.sort((a, b) => a.project.localeCompare(b.project) || a.label.localeCompare(b.label));
  return lanes;
}

export const LANE_MIN = 220;
export const LANE_MAX = 360;
export const LANE_GAP = 8;

/** PROJ-085: a lane is as wide as the board allows for its lane count, held between the limits. */
export function laneWidth(viewport: number, laneCount: number): number {
  if (laneCount <= 0) return LANE_MAX;
  const fit = Math.floor((viewport - LANE_GAP * (laneCount + 1)) / laneCount);
  return Math.max(LANE_MIN, Math.min(LANE_MAX, fit));
}

/** Left edge of lane `i`. */
export function laneLeft(i: number, width: number): number {
  return LANE_GAP + i * (width + LANE_GAP);
}

/** PROJ-085: a drop on a gap (or past either end) goes to the nearest lane. */
export function nearestLane(x: number, laneCount: number, width: number): number {
  if (laneCount <= 0) return -1;
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < laneCount; i++) {
    const left = laneLeft(i, width);
    const dist = x < left ? left - x : x > left + width ? x - (left + width) : 0;
    if (dist < bestDist) {
      best = i;
      bestDist = dist;
    }
  }
  return best;
}

/** VIEW-027: the half-open range [start, end) of `count` equal items near the visible part, plus a few either side. */
export function windowRange(scroll: number, viewport: number, itemSize: number, count: number, overscan = 3): [number, number] {
  if (count <= 0 || itemSize <= 0) return [0, 0];
  const first = Math.floor(Math.max(0, scroll) / itemSize);
  const last = Math.ceil((Math.max(0, scroll) + Math.max(0, viewport)) / itemSize);
  return [Math.max(0, first - overscan), Math.min(count, last + overscan)];
}

/** Lane range for the horizontal scroll: lanes are `width` wide with LANE_GAP between. */
export function laneRange(scroll: number, viewport: number, width: number, count: number): [number, number] {
  return windowRange(scroll, viewport, width + LANE_GAP, count, 1);
}

/** PROJ-085: Escape closes the board only when no popover (the status menu) is open; that one closes first. */
export function escapeAction(popoverOpen: boolean): "close-popover" | "close-board" {
  return popoverOpen ? "close-popover" : "close-board";
}

/** PROJ-085: the search starts empty every time the board opens. */
export const FRESH_QUERY = "";

/** The paths that move when a card is dragged: the whole selection if the card is in it, else the card alone. */
export function dragSet(selected: Set<string>, path: string): string[] {
  return selected.has(path) ? [...selected] : [path];
}

/** Clicking selects only that card; Ctrl/Shift-click toggles it in the selection. */
export function pick(selected: Set<string>, path: string, additive: boolean): Set<string> {
  if (!additive) return new Set([path]);
  const next = new Set(selected);
  if (!next.delete(path)) next.add(path);
  return next;
}

/** VIEW-027: a lane's header selects every card in the lane, including cards not drawn. */
export function selectLane(lane: BoardLane): Set<string> {
  return new Set(lane.cards.map((c) => c.path));
}

export const DRAG_TYPE = "application/x-kolux-workspace";

/** PROJ-085: a row dragged from the sidebar carries its folder; anything else dropped is ignored. */
export function droppedPaths(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.length > 0) : [];
  } catch {
    return [];
  }
}

/** What the board says when a drop or Move was refused and the cards went back where they were. */
export function moveFailure(count: number, reason: string): string {
  const what = count === 1 ? "that workspace was" : `those ${count} workspaces were`;
  return `The move did not go through, so ${what} put back where ${count === 1 ? "it" : "they"} came from. ${reason}`.trim();
}

/** What the board says when some projects' workspaces could not be listed (their cards are missing); null when all were read. */
export function listFailure(projects: string[]): string | null {
  if (projects.length === 0) return null;
  const shown = projects.slice(0, 3).join(", ") + (projects.length > 3 ? `, and ${projects.length - 3} more` : "");
  return `Could not list the workspaces of ${shown}, so their cards are missing here.`;
}

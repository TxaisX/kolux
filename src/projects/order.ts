// PROJ-016 and PROJ-049: dragging into order. Pure rules, so they are tested without a window.
// Header order is kept per sibling set as one list of ids; workspace order is one list of path keys.

import type { Node } from "./groups";
import type { GroupBy, SortBy } from "./rows";

/** PROJ-016: the saved order of project and group headers (ids). */
export const HEADER_ORDER_SETTING = "projectHeaderOrder";
/** PROJ-049: the saved manual order of workspaces (path keys). */
export const MANUAL_ORDER_SETTING = "manualWorkspaceOrder";

/** A setting read back as a list of strings; anything else is an empty list. */
export const idsFrom = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/**
 * Items in saved order; those with no saved position come last, groups before projects when `rank`
 * says so, then by name (PROJ-016).
 */
export function inSavedOrder<T>(items: T[], id: (t: T) => string, saved: string[], name: (t: T) => string, rank: (t: T) => number = () => 0): T[] {
  const at = (t: T) => saved.indexOf(id(t));
  return [...items].sort((a, b) => {
    const [ia, ib] = [at(a), at(b)];
    if (ia >= 0 && ib >= 0) return ia - ib;
    if (ia >= 0 || ib >= 0) return ia >= 0 ? -1 : 1;
    return rank(a) - rank(b) || name(a).localeCompare(name(b));
  });
}

/** The ids of the headers that sit beside `id` (itself included), in the order they are drawn; null when it is not in the tree. */
export function siblingIds(tree: Node[], id: string): string[] | null {
  const idOf = (n: Node) => (n.kind === "group" ? n.group.id : n.project.id);
  if (tree.some((n) => idOf(n) === id)) return tree.map(idOf);
  for (const n of tree) {
    if (n.kind !== "group") continue;
    const inside = siblingIds(n.children, id);
    if (inside) return inside;
  }
  return null;
}

/**
 * Which sibling a dropped header goes before: the target when the pointer is in its upper half,
 * else the one after it (null: last). A header dropped on itself, or onto something that is not
 * among its siblings, gives undefined: nothing moves.
 */
export function dropBefore(siblings: string[], dragged: string, target: string, upperHalf: boolean): string | null | undefined {
  if (!siblings.includes(dragged) || !siblings.includes(target) || dragged === target) return undefined;
  if (upperHalf) return target;
  const rest = siblings.filter((s) => s !== dragged);
  const next = rest[rest.indexOf(target) + 1];
  return next ?? null;
}

/** The saved order after `dragged` goes before `before` (null: to the end) among `siblings`; other ids keep their saved place. */
export function moveHeader(saved: string[], siblings: string[], dragged: string, before: string | null): string[] {
  if (!siblings.includes(dragged) || (before !== null && !siblings.includes(before))) return saved;
  const rest = siblings.filter((s) => s !== dragged);
  const at = before === null ? rest.length : rest.indexOf(before);
  const next = [...rest.slice(0, at), dragged, ...rest.slice(at)];
  return [...saved.filter((s) => !siblings.includes(s)), ...next];
}

/** PROJ-049: rows in the saved manual order; rows the order does not know keep their place after it. */
export function manualOrder<T>(rows: T[], key: (t: T) => string, saved: string[]): T[] {
  const known = rows.filter((r) => saved.includes(key(r))).sort((a, b) => saved.indexOf(key(a)) - saved.indexOf(key(b)));
  return [...known, ...rows.filter((r) => !saved.includes(key(r)))];
}

/** PROJ-049: the order a drag starts from: the saved one while in Manual order, else what is on screen now. */
export function dragStart(sort: SortBy, saved: string[], onScreen: string[]): string[] {
  return sort === "manual" ? manualOrder(onScreen, (k) => k, saved) : onScreen;
}

/**
 * PROJ-049: the order after the rows in `moved` (kept in their current relative order) go before
 * `before` (null: to the end). Dropping on one of the moved rows moves nothing.
 */
export function moveRows(order: string[], moved: string[], before: string | null): string[] {
  const set = new Set(moved.filter((m) => order.includes(m)));
  if (set.size === 0 || (before !== null && (set.has(before) || !order.includes(before)))) return order;
  const picked = order.filter((k) => set.has(k));
  const rest = order.filter((k) => !set.has(k));
  const at = before === null ? rest.length : rest.indexOf(before);
  return [...rest.slice(0, at), ...picked, ...rest.slice(at)];
}

/**
 * PROJ-049: what a drop of a row does. Grouped by status and not in Manual order, a drop into
 * another lane changes only the status; any other drop saves the order (and the list becomes Manual).
 */
export function dropOutcome(groupBy: GroupBy, sort: SortBy, fromLane: string, toLane: string): "status" | "order" {
  return groupBy === "status" && sort !== "manual" && fromLane !== toLane ? "status" : "order";
}

/** PROJ-049: how far to scroll the list while a drag is near its top or bottom edge (negative: up). */
export function edgeScroll(pointerY: number, top: number, bottom: number, zone = 28, step = 14): number {
  if (pointerY < top + zone) return -step;
  if (pointerY > bottom - zone) return step;
  return 0;
}

/** The order after `id` swaps places with its neighbour (up = earlier); at either end nothing changes. */
export function stepRow(order: string[], id: string, dir: -1 | 1): string[] {
  const at = order.indexOf(id);
  const to = at + dir;
  if (at < 0 || to < 0 || to >= order.length) return order;
  const next = [...order];
  [next[at], next[to]] = [next[to], next[at]];
  return next;
}

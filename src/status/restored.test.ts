import { expect, test } from "vitest";
import { stopLine } from "../terminal/notify";
import { restoration, shownState, RESTART_TEXT, type SavedRow } from "./restored";

const row = (paneKey: number, state: string, extra: Partial<SavedRow> = {}): SavedRow => ({ paneKey, agent: "claude", state, at: 1, unconfirmed: true, restart: false, ...extra });
/** The panes that came back from the saved layout, with no session saved. */
const came = (...keys: number[]) => new Map(keys.map((k): [number, string | undefined] => [k, undefined]));

test("a restored row shows on a loaded pane with no live reading, marked stale until an event confirms it (STAT-030)", () => {
  const r = restoration([row(1, "working"), row(2, "done"), row(3, "waiting"), row(4, "working")], new Set([1, 2, 3]), new Set([3]), came(1, 2, 3, 4));
  expect(r.hook).toEqual({ 1: "working", 2: "done" });
  expect(r.stale).toEqual({ 1: true, 2: true });
});

test("a restored permission shows as waiting and names no tool, so it cannot drive approve", () => {
  const r = restoration([row(1, "permission")], new Set([1]), new Set(), came(1));
  expect(r.hook[1]).toBe("waiting");
  expect(r.turn[1]).toBeUndefined();
  expect(shownState("permission")).toBe("waiting");
  expect(shownState("not-a-state")).toBeNull();
});

test("kept child rows come back with the pane; a row no longer unconfirmed is skipped", () => {
  const children = [{ id: "a", kind: "worker", state: "working" as const }];
  const r = restoration([row(1, "working", { children }), row(2, "working", { unconfirmed: false })], new Set([1, 2]), new Set(), came(1, 2));
  expect(r.crew).toEqual({ 1: children });
  expect(r.hook[2]).toBeUndefined();
});

test("a pane whose hooks are from an older Kolux gets a blocked row asking to restart the terminal", () => {
  const r = restoration([row(1, "working", { restart: true })], new Set([1]), new Set(), came(1));
  expect(r.hook[1]).toBe("blocked");
  expect(r.turn[1].stop.detail).toBe(RESTART_TEXT);
  // T-167-b: it is a restart, not an AI error
  expect(r.turn[1].stop.cause).toBe("restart");
  expect(stopLine(r.turn[1].stop)).not.toMatch(/error/i);
  expect(stopLine(r.turn[1].stop)).toMatch(/^Restart this terminal/);
});

// T-618 (F05-app-shell-launch.3): pane numbers are reused, so a saved row goes only to a pane that came back from the
// saved layout (`back`, with the session it was saved with), never to a new tab given a closed tab's number.
test("a closed tab's saved status does not attach to a new tab with the same number", () => {
  // run 1: tab 5 asked a question and was closed; the layout came back with tabs 1 and 2 only
  const rows = [row(5, "waiting", { sessionId: "closed-tab" }), row(2, "working", { sessionId: "s2" })];
  const back = new Map<number, string | undefined>([[1, undefined], [2, "s2"]]);
  // run 2: a brand-new third tab gets number 5
  const r = restoration(rows, new Set([1, 2, 5]), new Set(), back);
  expect(r.hook).toEqual({ 2: "working" });
  expect(r.stale[5]).toBeUndefined();
  // a row without a session id is held to the same rule
  expect(restoration([row(5, "working")], new Set([5]), new Set(), back).hook).toEqual({});
});

test("a row goes to a restored pane only when the pane carries the row's session", () => {
  const back = new Map<number, string | undefined>([[3, "mine"], [4, undefined]]);
  const r = restoration([row(3, "working", { sessionId: "another" }), row(4, "waiting", { sessionId: "lost" })], new Set([3, 4]), new Set(), back);
  expect(r.hook).toEqual({});
  expect(restoration([row(3, "working", { sessionId: "mine" }), row(4, "done")], new Set([3, 4]), new Set(), back).hook).toEqual({ 3: "working", 4: "done" });
});

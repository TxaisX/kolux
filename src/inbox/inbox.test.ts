import { expect, test } from "vitest";
import { changesLine, fromDetail, DONE_LIMIT, GROUPS, exitNote, inboxItems, moveSelection, openLabel, settle, type Source } from "./inbox";

const MIN = 60_000;
const now = 10_000 * MIN;
const src = (key: number, state: Source["state"], extra: Partial<Source> = {}): Source => ({ key, agent: "claude", title: `Claude ${key}`, branch: "main", cwd: "G:/repo", state, interrupted: false, running: true, changed: now - key * MIN, finishedAt: null, ...extra });

test("two agents waiting and one finished are two needs-you items and one done-today item, newest first (STAT-050)", () => {
  const items = inboxItems([src(1, "permission"), src(2, "waiting"), src(3, "done", { finishedAt: now - 5 * MIN }), src(4, "working"), src(5, "idle", { agent: "shell", running: false })], now);
  expect(items.map((i) => [i.group, i.key, i.label])).toEqual([
    ["needs", 1, "Permission"],
    ["needs", 2, "Question"],
    ["waiting", 4, "Running"],
    ["done", 3, "Done"],
  ]);
  // Prompts that ask for approval are permissions, the rest questions; a blocked agent needs you too.
  expect(inboxItems([src(1, "blocked")], now)[0]).toMatchObject({ group: "needs", label: "Blocked" });
});

test("done today leaves out the interrupted, anything older than 30 minutes, and everything past the 20 newest (STAT-050)", () => {
  expect(inboxItems([src(1, "done", { finishedAt: now - 40 * MIN })], now)).toEqual([]);
  expect(inboxItems([src(1, "done", { finishedAt: now - 30 * MIN })], now)).toHaveLength(1);
  expect(inboxItems([src(1, "interrupted", { finishedAt: now - MIN })], now)).toEqual([]);
  expect(inboxItems([src(1, "done", { finishedAt: now - MIN, interrupted: true })], now)).toEqual([]);
  const many = Array.from({ length: 25 }, (_, i) => src(i + 1, "done", { finishedAt: now - i * 1000 }));
  const done = inboxItems(many, now);
  expect(done).toHaveLength(DONE_LIMIT);
  expect(done[0].key).toBe(1);
  expect(done[DONE_LIMIT - 1].key).toBe(DONE_LIMIT);
});

test("Down with nothing selected picks the first row, Up the last; movement stops at both ends; a vanished selection goes back to the first row (STAT-050)", () => {
  const keys = [7, 8, 9];
  expect(moveSelection(keys, null, 1)).toBe(7);
  expect(moveSelection(keys, null, -1)).toBe(9);
  expect(moveSelection(keys, 7, -1)).toBe(7);
  expect(moveSelection(keys, 9, 1)).toBe(9);
  expect(moveSelection(keys, 7, 1)).toBe(8);
  expect(moveSelection([], null, 1)).toBeNull();
  expect(settle(keys, 8)).toBe(8);
  expect(settle(keys, 5)).toBe(7);
  expect(settle([], 5)).toBeNull();
  expect(settle(keys, null)).toBeNull();
});

test("an item that needs an answer offers Answer in Code, since nothing is answered in the Inbox yet; the rest offer Open in Code (EDIT-041)", () => {
  const items = inboxItems([src(1, "permission", { running: false }), src(2, "waiting"), src(3, "working"), src(4, "done", { finishedAt: now - MIN })], now);
  expect(items.map((i) => [i.key, openLabel(i)])).toEqual([
    [1, "Answer in Code"],
    [2, "Answer in Code"],
    [3, "Open in Code"],
    [4, "Open in Code"],
  ]);
});

test("T-035-b: a question or permission whose terminal has exited stays in Needs you as Answer in Code and says its terminal is gone; a finished or running item says nothing (EDIT-041)", () => {
  const items = inboxItems([src(1, "permission", { running: false }), src(2, "waiting"), src(3, "waiting", { running: false, interrupted: true }), src(4, "done", { running: false, finishedAt: now - MIN }), src(5, "working")], now);
  expect(items.map((i) => [i.key, i.group, i.exited, openLabel(i), exitNote(i) === null])).toEqual([
    [1, "needs", true, "Answer in Code", false],
    [2, "needs", false, "Answer in Code", true],
    [3, "needs", true, "Answer in Code", false],
    [5, "waiting", false, "Open in Code", true],
    [4, "stopped", false, "Open in Code", true],
  ]);
  expect(exitNote(items[0])).toMatch(/terminal has exited/);
});

test("FIX-1: a blocked item whose terminal exited (a stop, not a prompt) gets its own sentence and never says a prompt cannot be answered", () => {
  const [blocked] = inboxItems([src(1, "blocked", { running: false })], now);
  expect(blocked).toMatchObject({ group: "needs", exited: true });
  expect(exitNote(blocked)).toMatch(/stopped/);
  expect(exitNote(blocked)).not.toMatch(/prompt/);
  const [asked] = inboxItems([src(2, "waiting", { running: false })], now);
  expect(exitNote(asked)).toMatch(/prompt cannot be answered/);
});

test("DT-C52: an agent whose program has exited is listed as Stopped, after Done today, never as Done; the 30-minute window and the limit hold for it too", () => {
  const items = inboxItems([src(1, "done", { running: false, finishedAt: now - 2 * MIN }), src(2, "done", { finishedAt: now - MIN }), src(3, "done", { running: false, finishedAt: now - 40 * MIN }), src(4, "done", { running: false, interrupted: true, finishedAt: now - 3 * MIN })], now);
  expect(items.map((i) => [i.key, i.group, i.label, i.state])).toEqual([
    [2, "done", "Done", "done"],
    [1, "stopped", "Stopped", "stopped"],
    [4, "stopped", "Stopped", "stopped"],
  ]);
  expect(GROUPS.map((g) => g.title)).toEqual(["Needs you", "Waiting on agent", "Done today", "Stopped"]);
  // The heading's hover line says why a session is in that group, so Done and Stopped cannot be confused.
  expect(GROUPS.every((g) => g.about.trim() !== "")).toBe(true);
  expect(GROUPS.find((g) => g.id === "stopped")!.about).toMatch(/program exited/);
  expect(GROUPS.find((g) => g.id === "done")!.about).toMatch(/still running/);
  expect(inboxItems(Array.from({ length: 25 }, (_, i) => src(i + 1, "done", { running: false, finishedAt: now - i * 1000 })), now)).toHaveLength(DONE_LIMIT);
});

test("a key pressed on the detail pane's button is not the list's (so Enter on Review changes still works)", () => {
  const inside = { closest: (s: string) => (s === ".detail" ? {} : null) };
  const outside = { closest: () => null };
  expect(fromDetail(inside)).toBe(true);
  expect(fromDetail(outside)).toBe(false);
  expect(fromDetail(null)).toBe(false);
});

test("a failed status read is told, not shown as 'No files changed'", () => {
  expect(changesLine({ hasCwd: true, changed: null, staged: 0, failed: "not a git repository" })).toBe("Could not read the changes: not a git repository");
  expect(changesLine({ hasCwd: true, changed: 0, staged: 0, failed: null })).toBe("No files changed");
  expect(changesLine({ hasCwd: true, changed: 3, staged: 1, failed: null })).toBe("3 files changed, 1 staged");
  expect(changesLine({ hasCwd: true, changed: null, staged: 0, failed: null })).toBe("…");
  expect(changesLine({ hasCwd: false, changed: null, staged: 0, failed: null })).toBe("—");
});

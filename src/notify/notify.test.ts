import { expect, test } from "vitest";
import { badgeCount } from "./badge";
import { COOLDOWN_MS, MEMORY_CAP, newPaceMemory, paced } from "./pace";
import { ackKey, toAcknowledge } from "./seen";

// Fixed ids: the pacer treats an id as opaque, so the cases below name theirs.
const fixed = (pane: number, what: string, at: number): string => `${pane}:${what}:${at}`;

test("two completions from one worktree inside the cooldown are one notification (STAT-044)", () => {
  const mem = newPaceMemory();
  expect(paced(mem, "G:/w/a", fixed(1, "done", 1_000), 1_000)).toBe(true);
  // a bell for the same event, and another pane in the same worktree, fold into the first
  expect(paced(mem, "G:/w/a", fixed(1, "bell", 1_000), 1_200)).toBe(false);
  expect(paced(mem, "G:/w/a", fixed(2, "done", 1_500), 1_500)).toBe(false);
  // another worktree is its own notification
  expect(paced(mem, "G:/w/b", fixed(3, "done", 1_600), 1_600)).toBe(true);
  // after the cooldown the worktree may speak again
  expect(paced(mem, "G:/w/a", fixed(1, "done", 9_000), 1_000 + COOLDOWN_MS)).toBe(true);
});

test("the same event never shows twice, a test ignores the pace, focus can silence it (STAT-044)", () => {
  const mem = newPaceMemory();
  const id = fixed(1, "done", 1_000);
  expect(paced(mem, "G:/w/a", id, 1_000)).toBe(true);
  expect(paced(mem, "G:/w/a", id, 1_000 + 2 * COOLDOWN_MS)).toBe(false);
  // a merged repeat is remembered too: it does not surface once the cooldown passes
  const merged = fixed(1, "bell", 1_000);
  paced(mem, "G:/w/a", merged, 1_100);
  expect(paced(mem, "G:/w/a", merged, 1_000 + 2 * COOLDOWN_MS)).toBe(false);
  expect(paced(mem, "G:/w/a", "test", 1_001, { test: true })).toBe(true);
  expect(paced(mem, "G:/w/c", fixed(9, "done", 1), 1, { focused: true, quietWhenFocused: true })).toBe(false);
  expect(paced(mem, "G:/w/c", fixed(9, "done", 1), 1, { focused: true })).toBe(true);
});

test("the memory stays bounded during a burst (STAT-044)", () => {
  const mem = newPaceMemory();
  for (let i = 0; i < MEMORY_CAP * 3; i++) paced(mem, `G:/w/${i}`, fixed(i, "done", i), i);
  expect(mem.shown.size).toBe(MEMORY_CAP);
  expect(mem.shown.has(fixed(0, "done", 0))).toBe(false);
  expect(mem.shown.has(fixed(MEMORY_CAP * 3 - 1, "done", MEMORY_CAP * 3 - 1))).toBe(true);
});

test("the badge counts workspaces, not tabs, caps and clears (STAT-048)", () => {
  const panes = [
    { key: 1, cwd: "G:/w/a" },
    { key: 2, cwd: "G:\\w\\a\\" },
    { key: 3, cwd: "G:/w/a" },
    { key: 4, cwd: "G:/w/b" },
    { key: 5, cwd: null },
  ];
  expect(badgeCount([1, 2, 3], panes)).toBe(1);
  expect(badgeCount([1, 4], panes)).toBe(2);
  expect(badgeCount([1, 4, 5], panes)).toBe(3);
  expect(badgeCount([], panes)).toBe(0);
  expect(badgeCount([7], panes)).toBe(0); // a closed pane counts for nothing
  expect(badgeCount([1, 4], panes, 1)).toBe(1);
});

test("a finished session in view of a focused window is seen; a hand-marked one stays unread (STAT-049)", () => {
  const base = { unread: [1, 2, 3], inView: (k: number) => k !== 3, focused: true, manual: new Set([2]), stampOf: () => 500, acked: new Set<string>() };
  expect(toAcknowledge(base)).toEqual({ panes: [1], acks: [ackKey(1, 500)] });
  expect(toAcknowledge({ ...base, focused: false }).panes).toEqual([]);
});

test("a pane with no status yet keeps being watched, a future turn is acknowledged once (STAT-049)", () => {
  const stamps: Record<number, number | undefined> = { 1: undefined, 2: Date.now() + 60_000 };
  const i = { unread: [1, 2], inView: () => true, focused: true, manual: new Set<number>(), stampOf: (k: number) => stamps[k], acked: new Set<string>() };
  const first = toAcknowledge(i);
  expect(first.panes).toEqual([2]);
  // the same future-stamped turn, marked unread again by a late event, is not acknowledged twice
  expect(toAcknowledge({ ...i, acked: new Set(first.acks) }).panes).toEqual([]);
  // the status arrives: pane 1 is acknowledged now
  stamps[1] = 700;
  expect(toAcknowledge({ ...i, acked: new Set(first.acks) }).panes).toEqual([1]);
});

test("a needs-you stop is not hidden by a task-complete just before it in the same worktree", () => {
  const mem = newPaceMemory();
  expect(paced(mem, "G:/w/a", fixed(1, "done", 1_000), 1_000, { kind: "finish" })).toBe(true);
  expect(paced(mem, "G:/w/a", fixed(2, "stop", 1_500), 1_500, { kind: "stop" })).toBe(true);
  // a second stop inside the cooldown still folds into the first stop, and a finish folds into the finish
  expect(paced(mem, "G:/w/a", fixed(3, "stop", 1_800), 1_800, { kind: "stop" })).toBe(false);
  expect(paced(mem, "G:/w/a", fixed(4, "done", 1_900), 1_900, { kind: "finish" })).toBe(false);
  // without a kind nothing changes: the finish cooldown covers it
  const old = newPaceMemory();
  expect(paced(old, "G:/w/a", fixed(1, "done", 1_000), 1_000)).toBe(true);
  expect(paced(old, "G:/w/a", fixed(2, "stop", 1_500), 1_500)).toBe(false);
});

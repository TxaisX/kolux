// TERM-055 acceptance: a background tab whose agent finishes shows an unread badge until viewed; an idle shell tab shows no badge.
import { expect, test } from "vitest";
import { toAcknowledge } from "../../notify/seen";
import { marksUnread, tabBadge } from "../tabs";

test("box 1: a background tab's finish marks it unread (bell badge) and viewing it brings back the plain done check", () => {
  const known = new Set([1, 2]);
  let unread = new Set<number>();
  // before the finish: pane 2 is working in a tab nobody is looking at
  expect(tabBadge("claude", true, false, unread.has(2), "working")).toBe("working");
  // the agent in pane 2 finishes: process ends (or its hook says done) while pane 1 is the tab on top in a focused window
  const inView = (k: number) => k === 1;
  expect(marksUnread(2, known, unread, inView(2), true)).toBe(true); // useAgentStatus.ts:180
  unread = new Set([...unread, 2]);
  expect(tabBadge("claude", false, false, unread.has(2))).toBe("unread");
  expect(tabBadge("claude", true, false, unread.has(2), "done")).toBe("unread");
  // still unread while the window stays on pane 1: nothing acknowledges it
  const stamp = (k: number) => (k === 2 ? 5 : undefined);
  expect(toAcknowledge({ unread, inView, focused: true, manual: new Set(), stampOf: stamp, acked: new Set() }).panes).toEqual([]);
  // the user opens the tab: it is in view in a focused window, the mark clears, the badge falls back to done
  const open = (k: number) => k === 2;
  const seen = toAcknowledge({ unread, inView: open, focused: true, manual: new Set(), stampOf: stamp, acked: new Set() }).panes;
  expect(seen).toEqual([2]);
  unread = new Set([...unread].filter((k) => !seen.includes(k))); // useAgentStatus.ts:328
  expect(tabBadge("claude", false, false, unread.has(2))).toBe("stopped"); // DT-C52 (round 3): an exited agent's plain mark is Stopped
  expect(tabBadge("claude", true, false, unread.has(2), "done")).toBe("done"); // a turn done, program still up: the done check
});

test("box 2: an idle shell tab carries no badge, not even with a stale question or a hook reading", () => {
  expect(tabBadge("shell", true, false, false)).toBeNull();
  expect(tabBadge("shell", undefined, false, false)).toBeNull();
  expect(tabBadge("shell", true, false, false, "done")).toBeNull();
  expect(tabBadge("shell", true, false, false, "working")).toBeNull();
  expect(tabBadge("shell", false, false, false)).toBeNull(); // an ended shell too
  // a shell the user never looked at after a bell does show the bell, which is not "idle"
  expect(tabBadge("shell", true, false, true)).toBe("unread");
});

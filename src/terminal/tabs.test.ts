import { expect, test } from "vitest";
import { handlesIn, marksUnread, nameKey, newName, tabMenu, waitingInGrid, tabBadge } from "./tabs";
import { NEEDS_STRIP_FIELD, stripOn } from "../settings/general";

test("a tab shows one badge: spinner, question mark, bell or check; an idle shell shows none (TERM-055)", () => {
  expect(tabBadge("claude", undefined, false, false)).toBe("working");
  expect(tabBadge("claude", true, false, false)).toBe("working");
  expect(tabBadge("claude", true, true, false)).toBe("permission");
  expect(tabBadge("claude", false, false, true)).toBe("unread");
  expect(tabBadge("claude", false, false, false)).toBe("stopped"); // DT-C52: an exited agent's tab is Stopped, as its header
  expect(tabBadge("shell", true, false, false)).toBeNull();
  expect(tabBadge("shell", undefined, false, false)).toBeNull();
  expect(tabBadge("shell", true, false, true)).toBe("unread");
});

test("a finish or bell marks the pane unread unless it is in view in a focused window; late events are dropped (TERM-118)", () => {
  const known = new Set([1, 2]);
  expect(marksUnread(2, known, new Set(), false, true)).toBe(true); // a hidden tab or split pane
  expect(marksUnread(1, known, new Set(), true, false)).toBe(true); // Kolux in the background
  expect(marksUnread(1, known, new Set(), true, true)).toBe(false); // the pane being looked at
  expect(marksUnread(3, known, new Set(), false, true)).toBe(false); // the pane is gone
  expect(marksUnread(2, known, new Set([2]), false, true)).toBe(false); // already marked
});

test("a running agent whose hook says done shows the check, or the bell when unread; a question wins (STAT-001)", () => {
  expect(tabBadge("claude", true, false, false, "done")).toBe("done");
  expect(tabBadge("claude", true, false, true, "done")).toBe("unread");
  expect(tabBadge("claude", true, true, false, "done")).toBe("permission");
  expect(tabBadge("claude", true, false, false, "working")).toBe("working");
  expect(tabBadge("claude", true, false, false, "permission")).toBe("working");
});

test("a name field saves on Enter or Tab and cancels on Escape; an Enter that confirms an IME candidate does nothing (TERM-027, TERM-048)", () => {
  expect(nameKey({ key: "Enter", isComposing: false, keyCode: 13 })).toBe("save");
  expect(nameKey({ key: "Tab", isComposing: false, keyCode: 9 })).toBe("save");
  expect(nameKey({ key: "Escape", isComposing: false, keyCode: 27 })).toBe("cancel");
  expect(nameKey({ key: "Enter", isComposing: true, keyCode: 13 })).toBeNull();
  expect(nameKey({ key: "Enter", isComposing: false, keyCode: 229 })).toBeNull();
  expect(nameKey({ key: "a", isComposing: false, keyCode: 65 })).toBeNull();
  // A blank name gives the automatic title back; anything else is kept trimmed.
  expect(newName("  Build server  ")).toBe("Build server");
  expect(newName("   ")).toBeUndefined();
  expect(newName("서버")).toBe("서버");
});

test("the needs-you strip lists this grid's sessions waiting on a permission or a question, in grid order (TERM-029)", () => {
  const hook = { 1: "permission", 2: "working", 3: "waiting", 4: "blocked", 5: "permission" } as const;
  expect(waitingInGrid([3, 1, 2, 4], hook)).toEqual([3, 1]);
  expect(waitingInGrid([2, 4], hook)).toEqual([]);
  expect(waitingInGrid([], hook)).toEqual([]);
  // The strip is on unless turned off.
  expect(stripOn({})).toBe(true);
  expect(stripOn({ [NEEDS_STRIP_FIELD]: false })).toBe(false);
});

test("only a whole-word term-N handle is a link, with its place in the line (TERM-096)", () => {
  expect(handlesIn("sent to term-3, then term-12.")).toEqual([
    { start: 8, end: 14, handle: "term-3" },
    { start: 21, end: 28, handle: "term-12" },
  ]);
  // Text that only looks like a handle is not one.
  expect(handlesIn("TERM=xterm-256color term-x term3 term-3a my-term-4 term-5-b")).toEqual([]);
  expect(handlesIn("(term-7)")).toEqual([{ start: 1, end: 7, handle: "term-7" }]);
});

test("a tab's menu offers Rename for a terminal or agent tab and Close for every tab (TERM-048)", () => {
  expect(tabMenu(undefined).map((i) => i.id)).toEqual(["rename", "close"]);
  expect(tabMenu("editor").map((i) => i.id)).toEqual(["close"]);
  expect(tabMenu("browser").map((i) => i.id)).toEqual(["close"]);
  expect(tabMenu(undefined)[0]).toMatchObject({ label: "Rename tab", keys: "tab.rename" });
});

test("DT-C52: a blocked or interrupted agent's tab shows Stopped, not the question mark and not a spinner; an unseen stop keeps the bell", () => {
  for (const hook of ["blocked", "interrupted"] as const) {
    expect(tabBadge("claude", true, false, false, hook), hook).toBe("stopped");
    expect(tabBadge("claude", true, false, true, hook), hook).toBe("unread");
  }
  expect(tabBadge("claude", true, true, false, "blocked"), "a question still wins").toBe("permission");
});

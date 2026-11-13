import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { expect, test } from "vitest";
import { CACHE_LENGTH, CACHE_ON, cacheDue, cacheMinutes, cacheShown } from "./cache";
import { CacheTimerView } from "./CacheTimer";
import { CachePick } from "../settings/AgentsPage";
import { selectIn } from "../tasks/selectHtml";

const html = (e: ReturnType<typeof createElement>) => renderToString(e).replace(/<!-- -->/g, "");

test("T-265 SET-059: the timer is off by default; lengths are 5 minutes (default) and 1 hour", () => {
  expect(cacheMinutes({})).toBe(null);
  expect(cacheMinutes({ [CACHE_ON]: false, [CACHE_LENGTH]: 60 })).toBe(null);
  expect(cacheMinutes({ [CACHE_ON]: true })).toBe(5);
  expect(cacheMinutes({ [CACHE_ON]: true, [CACHE_LENGTH]: 60 })).toBe(60);
  expect(cacheMinutes({ [CACHE_ON]: true, [CACHE_LENGTH]: 17 })).toBe(5);
});

test("T-265 SET-059: only idle Claude panes start it; the nearest to running out is shown", () => {
  const min = 60_000;
  const claudeDone = { agent: "claude", state: "done", since: 1_000 };
  expect(cacheDue([claudeDone], 5)).toBe(1_000 + 5 * min);
  expect(cacheDue([claudeDone], null), "switched off: no countdown at all").toBe(null);
  expect(cacheDue([{ ...claudeDone, agent: "codex" }], 5), "only Claude agents").toBe(null);
  expect(cacheDue([{ ...claudeDone, state: "working" }], 5), "a working pane has no countdown").toBe(null);
  expect(cacheDue([{ ...claudeDone, state: "permission" }], 5)).toBe(null);
  expect(cacheDue([{ ...claudeDone, state: undefined }], 5), "no hook report yet: never went idle").toBe(null);
  expect(cacheDue([{ ...claudeDone, state: "interrupted" }], 5)).toBe(1_000 + 5 * min);
  // Two Claude tabs in one worktree went idle a minute apart: the earlier one runs out first.
  expect(cacheDue([{ ...claudeDone, since: 1_000 + min }, claudeDone, { agent: "claude", state: "working", since: 0 }], 5)).toBe(1_000 + 5 * min);
});

test("T-265 SET-059: minutes and seconds, yellow in the final minute, a red icon at zero", () => {
  expect(cacheShown(5 * 60_000)).toEqual({ text: "5:00", phase: "counting" });
  expect(cacheShown(5 * 60_000 - 3)).toEqual({ text: "5:00", phase: "counting" }); // it starts at 5:00
  expect(cacheShown(4 * 60_000 + 1_500)).toEqual({ text: "4:02", phase: "counting" });
  expect(cacheShown(60_000)).toEqual({ text: "1:00", phase: "counting" });
  expect(cacheShown(59_400)).toEqual({ text: "1:00", phase: "counting" });
  expect(cacheShown(59_000)).toEqual({ text: "0:59", phase: "last" });
  expect(cacheShown(400)).toEqual({ text: "0:01", phase: "last" });
  expect(cacheShown(0)).toEqual({ text: "", phase: "gone" });
  expect(cacheShown(-5_000)).toEqual({ text: "", phase: "gone" });
  expect(cacheShown(60 * 60_000)).toEqual({ text: "60:00", phase: "counting" });

  const counting = html(createElement(CacheTimerView, { left: 4 * 60_000 + 1_500 }));
  expect(counting).toContain("4:02");
  expect(counting).toContain('class="cache-timer"');
  expect(html(createElement(CacheTimerView, { left: 30_000 }))).toContain('class="cache-timer last"');
  const gone = html(createElement(CacheTimerView, { left: 0 }));
  expect(gone).toContain('class="cache-timer gone"');
  expect(gone).toContain("the next message sends the whole conversation again without the cache");
  expect(gone).not.toContain("0:00");
});

test("T-265 SET-059: the Agents page switch and its length", () => {
  const off = html(createElement(CachePick, { minutes: null, onPick: () => {} }));
  expect(off).toContain("Prompt-cache timer");
  expect(off).not.toContain('checked=""');
  expect(off).toContain("disabled");
  const on = html(createElement(CachePick, { minutes: 60, onPick: () => {} }));
  expect(on).toContain('checked=""');
  expect(selectIn(on, "Cache length")).toEqual({ chosen: "1 hour", offered: ["5 minutes", "1 hour"] });
});

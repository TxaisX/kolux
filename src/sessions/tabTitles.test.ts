import { expect, test } from "vitest";
import { askable, FOLLOW_MS, keepNames, retryDelay, RETRY_MS } from "./tabTitles";

test("VIEW-093: a missing name is asked about again soon, then at the slowest retry pace", () => {
  expect(retryDelay(0)).toBe(RETRY_MS[0]);
  expect(retryDelay(1)).toBe(RETRY_MS[1]);
  expect(retryDelay(99)).toBe(RETRY_MS[RETRY_MS.length - 1]);
  expect(RETRY_MS[0]).toBeLessThan(FOLLOW_MS);
});

test("VIEW-093: only an agent pane that reports a session is asked", () => {
  expect(askable({ key: 1, agent: "claude", session: "s" })).toBe(true);
  expect(askable({ key: 1, agent: "shell", session: "s" })).toBe(false);
  expect(askable({ key: 1, agent: "claude" })).toBe(false);
  expect(askable({ key: 1, agent: "claude", session: "s", kind: "diff" })).toBe(false);
  expect(askable({ key: 1, agent: "claude", session: "s", seats: [] })).toBe(false);
});

test("VIEW-093: a name stays with its tab (a sleeping tab keeps it) and goes when the tab or its session does", () => {
  const names = { 1: { session: "s1", name: "Login work" }, 2: { session: "s2", name: "Docs" } };
  const same = [
    { key: 1, agent: "claude", session: "s1" },
    { key: 2, agent: "claude", session: "s2" },
  ];
  expect(keepNames(names, same)).toBe(names); // nothing to change: the same object, no re-render
  expect(keepNames(names, [same[0]])).toEqual({ 1: names[1] });
  expect(keepNames(names, [same[0], { key: 2, agent: "claude", session: "s9" }])).toEqual({ 1: names[1] });
  expect(keepNames(names, [same[0], { key: 2, agent: "claude" }])).toEqual({ 1: names[1] });
});

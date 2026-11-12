import { expect, test } from "vitest";
import { livePane, samePrompt } from "./livePane";

const s = { agent: "claude", id: "sess-1" };
const pane = (key: number, extra: Record<string, unknown> = {}) => ({ key, agent: "claude", ...extra });

test("VIEW-088: a pane holding the session's id is the live one, even a retained or hidden one", () => {
  expect(livePane([pane(1), pane(2, { session: "sess-1" }), pane(3, { session: "sess-2" })], s, null)).toBe(2);
  // Another agent's pane with the same id text is not it; a diff tab or chooser is never it.
  expect(livePane([{ key: 1, agent: "codex", session: "sess-1" }], s, null)).toBeNull();
  expect(livePane([pane(1, { session: "sess-1", kind: "diff" }), pane(2, { session: "sess-1", seats: [] })], s, null)).toBeNull();
});

test("VIEW-088: without an id, an unambiguous first prompt finds the pane; two candidates or none do not", () => {
  const ask = "Fix the login bug";
  expect(livePane([pane(1, { typed: "  fix the   LOGIN bug " }), pane(2, { typed: "something else" })], s, ask)).toBe(1);
  expect(livePane([pane(1, { typed: ask }), pane(2, { typed: ask })], s, ask)).toBeNull();
  expect(livePane([pane(1, { typed: ask, session: "sess-9" })], s, ask)).toBeNull(); // it already has another session
  expect(livePane([pane(1, { typed: ask })], s, null)).toBeNull();
  expect(livePane([pane(1)], s, ask)).toBeNull();
});

test("VIEW-088: a prompt the back end cut with an ellipsis matches a longer opening line by its start", () => {
  expect(samePrompt("Refactor the whole settings page so that every field saves on blur", "Refactor the whole settings…")).toBe(true);
  expect(samePrompt("Something else entirely", "Refactor the whole settings…")).toBe(false);
  expect(samePrompt("", "x")).toBe(false);
  expect(samePrompt("x", "")).toBe(false);
});

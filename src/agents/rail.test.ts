// The Agents screen's rail (VIEW-015, VIEW-021) and the Board's card list (VIEW-024), pure so they run without a browser.
import { expect, test } from "vitest";
import { chipOf } from "../board/chip";
import { cardPanes, pickSession, railGroups, rowStatus, sessionLabel } from "./rail";

const saved = [
  { id: "claude", name: "Claude Code" },
  { id: "codex", name: "Codex" },
];
const ai = (key: number, agentId: string | undefined, extra: Record<string, unknown> = {}) => ({ key, agentId, program: "x", cwd: "C:/w/app", ...extra });
const shell = (key: number) => ({ key, program: null, cwd: "C:/w/app" });

test("VIEW-015: sessions group under their saved agent, unmatched ones under Other sessions, shells never", () => {
  const panes = [shell(1), ai(2, "claude"), ai(3, "grok"), ai(4, "claude"), { key: 5, program: null, cwd: null, seats: [{ agent: null }] }];
  const groups = railGroups(panes, saved);
  expect(groups.map((g) => [g.id, g.name, g.sessions.map((p) => p.key)])).toEqual([
    ["claude", "Claude Code", [2, 4]],
    ["other", "Other sessions", [3]],
  ]);
  // A saved agent with nothing open is not a group: the rail stays empty until a session exists.
  expect(railGroups([shell(1)], saved)).toEqual([]);
});

test("VIEW-021: a not-started preset sits under its agent; editor and browser tabs are never listed", () => {
  const panes = [ai(1, "codex", { kind: "editor" }), { key: 2, program: null, cwd: null, seats: [{ agent: "codex" }] }, ai(3, "claude", { kind: "browser" })];
  // Claude has no session open, so it gets no group, empty or otherwise.
  expect(railGroups(panes, saved).map((g) => [g.id, g.sessions.map((p) => p.key)])).toEqual([["codex", [2]]]);
});

test("VIEW-015: first open picks the first agent with sessions on its newest session; a remembered pick stays while it exists", () => {
  const groups = railGroups([ai(2, "claude"), ai(7, "grok"), ai(4, "claude")], saved);
  expect(pickSession(groups, null)).toBe(4);
  expect(pickSession(groups, 2)).toBe(2);
  expect(pickSession(groups, 9)).toBe(4);
  expect(pickSession(railGroups([ai(7, "grok")], saved), null)).toBe(7);
  expect(pickSession(railGroups([shell(1)], saved), null)).toBe(null);
});

test("VIEW-015: a session reads as its task's name, else its folder, else its number", () => {
  expect(sessionLabel({ key: 3, title: "Fix login", cwd: "C:/w/app" })).toBe("Fix login");
  expect(sessionLabel({ key: 3, cwd: "C:/w/app" })).toBe("app");
  expect(sessionLabel({ key: 3, cwd: null })).toBe("Session 3");
});

test("VIEW-024: the Board's cards are the terminal panes in order; editor and browser tabs get none", () => {
  const panes = [shell(1), ai(2, "claude", { kind: "editor" }), { key: 3, program: null, cwd: null, seats: [{ agent: null }] }, ai(4, "claude", { kind: "browser" }), ai(5, "codex")];
  expect(cardPanes(panes).map((p) => p.key)).toEqual([1, 3, 5]);
});

test("VIEW-017: a row's status word is one of the fixed set, from the same signal the Board reads", () => {
  const sig = (over: Record<string, unknown>) => chipOf({ agent: "claude", running: true, stale: false, since: 0, ...over }, 1000);
  // A preset that was never launched reads Not started; a pane with no process yet reads Starting.
  expect(rowStatus({ seats: [{ agent: "claude" }] }, null).word).toBe("Not started");
  expect(rowStatus({}, sig({ running: undefined })).word).toBe("Starting");
  // A stale working reading is never shown as Working; a process that ended without a done signal reads Stopped.
  expect(rowStatus({}, sig({ stale: true })).word).toBe("No recent update");
  expect(rowStatus({}, sig({ running: false })).word).toBe("Stopped");
  expect(rowStatus({}, sig({})).word).toBe("Working");
  expect(rowStatus({}, sig({ state: "permission" }))).toMatchObject({ word: "Needs you", tone: "attention" });
  expect(rowStatus({}, sig({ state: "done" })).word).toBe("Done");
  expect(rowStatus({}, sig({ state: "idle" })).word).toBe("Idle");
  // A session the Board has no signal for (a shell-marked program) reads Idle, never blank.
  expect(rowStatus({}, null).word).toBe("Idle");
  for (const r of [rowStatus({ seats: [] }, null), rowStatus({}, sig({ stale: true }))]) expect(r.explain.length).toBeGreaterThan(0);
});

test("T-050-b: an orchestrator-started session with no name or title reads as its worker's task, never the wrapper", () => {
  // The worker label (orchestration worker_labels) already holds the task's name or the brief's task text.
  expect(sessionLabel({ key: 3, cwd: "C:/w/app" }, "Fix the login form")).toBe("Fix the login form");
  expect(sessionLabel({ key: 3, title: "Login", cwd: "C:/w/app" }, "Fix the login form")).toBe("Login");
  expect(sessionLabel({ key: 3, cwd: "C:/w/app" }, "  ")).toBe("app");
  expect(sessionLabel({ key: 3, cwd: null }, undefined)).toBe("Session 3");
});

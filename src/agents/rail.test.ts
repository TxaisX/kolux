// The chat view's session label, pure so it runs without a browser.
import { expect, test } from "vitest";
import { sessionLabel } from "./rail";

test("VIEW-015: a session reads as its task's name, else its folder, else its number", () => {
  expect(sessionLabel({ key: 3, title: "Fix login", cwd: "C:/w/app" })).toBe("Fix login");
  expect(sessionLabel({ key: 3, cwd: "C:/w/app" })).toBe("app");
  expect(sessionLabel({ key: 3, cwd: null })).toBe("Session 3");
});

test("T-050-b: an orchestrator-started session with no name or title reads as its worker's task, never the wrapper", () => {
  // The worker label (orchestration worker_labels) already holds the task's name or the brief's task text.
  expect(sessionLabel({ key: 3, cwd: "C:/w/app" }, "Fix the login form")).toBe("Fix the login form");
  expect(sessionLabel({ key: 3, title: "Login", cwd: "C:/w/app" }, "Fix the login form")).toBe("Login");
  expect(sessionLabel({ key: 3, cwd: "C:/w/app" }, "  ")).toBe("app");
  expect(sessionLabel({ key: 3, cwd: null }, undefined)).toBe("Session 3");
});

// Row 389: a new agent tab started from the + menu or the project's launch button applies the model, effort and
// fast mode saved for that agent (CHAT-024). The chooser pane does it through savedSeat (controls.test.ts).
// The Everyday New session menu (DT-C285) overrides the saved model for that one session only: the project's
// launch button still falls back to the saved arguments when no model was picked.
import { expect, test } from "vitest";

import { windowSource } from "../test/windowSource";

// Cycle 2: the window's code is App.tsx and the files it was split into (test/windowSource.ts).
const app = windowSource;

test("the + menu's new agent tab starts with the agent's saved launch arguments", () => {
  expect(app).toMatch(/invoke<StartLine>\("agent_start_line", \{ id: a\.id, extra: savedArgs\(a\.id\), prompt: "" \}\)/);
});

test("a project's launch button starts the agent with its saved launch arguments", () => {
  // The folder is the worktree picked with "Start new sessions here", else the project folder.
  expect(app).toMatch(/const dir = startDirOf\(proj\.path\) \?\? proj\.path;/);
  // A picked model wins for that session; with none, the launch keeps the agent's saved arguments.
  // The agent id rides along, so the start line is built for that agent.
  expect(app).toMatch(/const extra = model && model !== DEFAULT_MODEL \? modelArgs\(model, agent\.id\) : savedArgs\(agent\.id\);/);
  expect(app).toMatch(/startIn\(agent, dir, branch, "", true, extra\)/);
});

test("App.tsx imports savedArgs from the chat controls", () => {
  expect(app).toMatch(/import \{[^}]*\bsavedArgs\b[^}]*\} from "\.\.?\/(?:\.\.\/)*chat\/controls"/);
});

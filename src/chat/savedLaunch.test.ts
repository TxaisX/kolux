// Row 389: a new agent tab started from the + menu or the project's launch button applies the model, effort and
// fast mode saved for that agent (CHAT-024). The chooser pane does it through savedSeat (controls.test.ts).
import { expect, test } from "vitest";

import { windowSource } from "../shell/windowSource";

// Cycle 2: the window's code is App.tsx and the files it was split into (shell/windowSource.ts).
const app = windowSource;

test("the + menu's new agent tab starts with the agent's saved launch arguments", () => {
  expect(app).toMatch(/invoke<StartLine>\("agent_start_line", \{ id: a\.id, extra: savedArgs\(a\.id\), prompt: "" \}\)/);
});

test("a project's launch button starts the agent with its saved launch arguments", () => {
  // The folder is the worktree picked with "Start new sessions here", else the project folder.
  expect(app).toMatch(/const dir = startDirOf\(proj\.path\) \?\? proj\.path;/);
  expect(app).toMatch(/startIn\(agent, dir, branch, "", true, savedArgs\(agent\.id\)\)/);
});

test("App.tsx imports savedArgs from the chat controls", () => {
  expect(app).toMatch(/import \{[^}]*\bsavedArgs\b[^}]*\} from "\.\.?\/(?:\.\.\/)*chat\/controls"/);
});

// T-780 follow-up: the reason the back end gives for a folder it did not mark trusted becomes one
// plain line in the window, built from trust.rs's own wording.
import { expect, test, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: () => Promise.reject("not stubbed") }));
vi.mock("@tauri-apps/api/event", () => ({ listen: () => Promise.resolve(() => {}) }));

const { holdsPullRequest, trustNote } = await import("./launchActions");

const projects = [{ path: "C:\\Users\\me\\code\\my-app", name: "my-app", displayName: "My App" }];

test("an untrusted main checkout names the project as the sidebar shows it, matched however the path is spelled", () => {
  const reason = "not trusted: the main checkout C:\\Users\\me\\code\\My-App is not trusted for claude yet, so its worktree C:\\Users\\me\\kolux\\wt-1 keeps the agent's own prompt";
  expect(trustNote("Claude", reason, projects)).toBe("Claude may ask whether to trust this workspace: you haven't trusted My App in Claude yet.");
  const unknown = "not trusted: the main checkout /home/me/other is not trusted for codex yet, so its worktree /home/me/w keeps the agent's own prompt";
  expect(trustNote("Codex", unknown, projects)).toBe("Codex may ask whether to trust this workspace: you haven't trusted other in Codex yet.");
});

test("with a managed account in use the line names that account, not Claude as a whole", () => {
  const reason = "not trusted: the main checkout C:\\Users\\me\\code\\my-app is not trusted for claude yet, so its worktree C:\\w keeps the agent's own prompt";
  expect(trustNote("Claude", reason, projects, true)).toBe("Claude may ask whether to trust this workspace: you haven't trusted My App in this Claude account yet.");
  expect(trustNote("Claude", reason, projects, false)).toBe("Claude may ask whether to trust this workspace: you haven't trusted My App in Claude yet.");
});

test("a pull request's worktree says why, in words", () => {
  expect(trustNote("Claude", "not trusted: this worktree holds a pull request's branch, so the agent asks itself", projects)).toBe(
    "Claude may ask whether to trust this workspace because it holds a pull request.",
  );
});

test("'is not a git worktree' becomes a plain line that names only the folder", () => {
  const line = trustNote("Claude", "not trusted: C:\\tmp\\loose-folder is not a git worktree, so it keeps the agent's own prompt", projects);
  expect(line).toBe("Claude may ask whether to trust this workspace: loose-folder isn't inside a git repository Kolux can check.");
  expect(line).not.toContain("worktree");
});

test("nothing Kolux made in the batch is silent; any other failure is still said", () => {
  expect(trustNote("Claude", "no folders to trust", projects)).toBeNull();
  expect(trustNote("Claude", "at most 12 folders can be trusted per launch, not 13", projects)).toBe(
    "Claude may ask whether to trust this workspace: Kolux couldn't mark it trusted (at most 12 folders can be trusted per launch, not 13).",
  );
});

test("only a pull request address counts as holding a pull request", () => {
  expect(holdsPullRequest("https://github.com/o/r/pull/12")).toBe(true);
  expect(holdsPullRequest(" https://github.com/o/r/pull/12/ ")).toBe(true);
  expect(holdsPullRequest("https://github.com/o/r/issues/12")).toBe(false);
  expect(holdsPullRequest("#12")).toBe(false);
  expect(holdsPullRequest(null)).toBe(false);
  expect(holdsPullRequest(undefined)).toBe(false);
});

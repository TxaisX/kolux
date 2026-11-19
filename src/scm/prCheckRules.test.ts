import { describe, expect, it } from "vitest";
import { failedChecks, fixBlocker, fixText } from "./prCheckRules";

describe("GIT-051 Fix with AI rules", () => {
  it("lets only a failed check with a run, and a workspace, be fixed with AI", () => {
    const bad = { id: 1, name: "build", status: "completed", conclusion: "failure", url: "https://github.com/a/b/actions/runs/9/job/3", runId: 9 };
    expect(fixBlocker(bad, "G:/w")).toBeNull();
    expect(fixBlocker(bad, null)).toMatch(/Start a workspace/);
    expect(fixBlocker({ ...bad, conclusion: "success" }, "G:/w")).toMatch(/Only a failed check/);
    expect(fixBlocker({ ...bad, status: "in_progress", conclusion: "" }, "G:/w")).toMatch(/Only a failed check/);
    expect(fixBlocker({ ...bad, runId: null }, "G:/w")).toMatch(/no workflow run/);
    expect(fixBlocker({ ...bad, url: "https://example.com/x" }, "G:/w")).toMatch(/no workflow run/);
    expect(failedChecks([bad, { ...bad, id: 2, conclusion: "success" }, { ...bad, id: 3, conclusion: "timed_out" }]).map((c) => c.id)).toEqual([1, 3]);
    const text = fixText(bad, "line\nboom");
    expect(text).toContain('The check "build" is failing on this pull request');
    expect(text).toContain("boom");
  });
});

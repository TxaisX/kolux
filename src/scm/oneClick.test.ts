import { beforeEach, describe, expect, it, vi } from "vitest";
import { blocker, clearOneClick, needsOneClick, oneClickRun, pushFor, startOneClick, stepWord, STEPS, type Ports } from "./oneClick";
import type { Status } from "./model";
import { renderToString } from "react-dom/server";
import { createElement } from "react";
import { OneClickView } from "./OneClickNotice";

const status = (o: Partial<Status> = {}): Status => ({ branch: "user/work", upstream: null, ahead: 0, behind: 0, rewritten: false, base: "origin/main", head: "h1", staged: [], changed: [], untracked: [], conflicts: [], operation: null, resolved: [], ...o });
const ch = (path: string) => ({ path, status: "M", from: null });
const ports = (over: Partial<Ports> = {}, seq: Status[] = [status({ changed: [ch("a.txt")] }), status({ head: "h2", ahead: 1, upstream: "origin/user/work" }), status({ head: "h2", ahead: 1, upstream: "origin/user/work" })]): Ports => {
  let i = 0;
  return {
    status: vi.fn(async () => seq[Math.min(i++, seq.length - 1)]),
    scan: vi.fn(async () => ({ kind: "clean" as const, message: "", files: [] })),
    stage: vi.fn(async () => undefined),
    message: vi.fn(async () => "Fix the thing"),
    commit: vi.fn(async () => ({ id: "abc", blocked: false, output: "" })),
    remote: vi.fn(async () => ({ ok: true, output: "" })),
    text: vi.fn(async () => ["Title", "Body"] as [string, string]),
    create: vi.fn(async () => ({ number: 7, url: "https://github.com/o/r/pull/7", state: "OPEN" })),
    ...over,
  };
};

describe("GIT-022 one click", () => {
  beforeEach(() => clearOneClick());
  it("commits, publishes and opens the pull request, ending in success", async () => {
    const p = ports();
    const run = await startOneClick("C:/w", p, true);
    expect(run.state).toBe("done");
    expect(run.pr?.number).toBe(7);
    expect(p.stage).toHaveBeenCalledWith("C:/w", ["a.txt"]);
    expect(p.commit).toHaveBeenCalledWith("C:/w", "Fix the thing");
    expect(p.create).toHaveBeenCalledWith("C:/w", "Title", "Body", "main");
    expect(oneClickRun("C:/w")?.state).toBe("done");
  });
  it("audit row 8: a cut status stages the whole worktree, and cut alone counts as work", async () => {
    const cut = status({ changed: [ch("a.txt")], cut: 250 });
    const p = ports({}, [cut, status({ head: "h2", ahead: 1, upstream: "origin/user/work" }), status({ head: "h2", ahead: 1, upstream: "origin/user/work" })]);
    const run = await startOneClick("C:/w", p, true);
    expect(run.state).toBe("done");
    expect(p.stage).toHaveBeenCalledWith("C:/w", ["."]);
    expect(needsOneClick(status({ upstream: "origin/user/work", cut: 3 }))).toBe(true);
    expect(needsOneClick(status({ upstream: "origin/user/work" }))).toBe(false);
  });
  it("audit row 8: a cut status is scanned first, and nothing is staged when the scan blocks", async () => {
    const cut = status({ changed: [ch("a.txt")], cut: 250 });
    const p = ports({ scan: vi.fn(async () => ({ kind: "blocked" as const, message: "A likely secret is in the files to commit.", files: [".env", "deploy.pem"] })) }, [cut]);
    const run = await startOneClick("C:/w", p, true);
    expect(run.state).toBe("failed");
    expect(run.message).toContain("A likely secret");
    expect(run.message).toContain(".env, deploy.pem");
    expect(p.scan).toHaveBeenCalledWith("C:/w");
    expect(p.stage).not.toHaveBeenCalled();
    expect(p.commit).not.toHaveBeenCalled();
    const failed = ports({ scan: vi.fn(async () => ({ kind: "failed" as const, message: "Could not list the files.", files: [] })) }, [cut]);
    expect((await startOneClick("C:/x", failed, true)).state).toBe("failed");
    expect(failed.stage).not.toHaveBeenCalled();
  });
  it("audit row 8: a clean scan comes before the whole-worktree stage, and a short status is not scanned", async () => {
    const cut = status({ changed: [ch("a.txt")], cut: 250 });
    const p = ports({}, [cut, status({ head: "h2", ahead: 1, upstream: "origin/user/work" }), status({ head: "h2", ahead: 1, upstream: "origin/user/work" })]);
    expect((await startOneClick("C:/w", p, true)).state).toBe("done");
    expect(p.scan).toHaveBeenCalledTimes(1);
    expect(p.stage).toHaveBeenCalledWith("C:/w", ["."]);
    expect((p.scan as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]).toBeLessThan((p.stage as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]);
    const short = ports();
    await startOneClick("C:/y", short, true);
    expect(short.scan).not.toHaveBeenCalled();
  });
  it("folders that differ only in case or slash style are one folder", async () => {
    let release: (o: { id: string; blocked: boolean; output: string }) => void = () => {};
    const p = ports({ commit: vi.fn(() => new Promise<{ id: string; blocked: boolean; output: string }>((r) => (release = r))) });
    const first = startOneClick("C:/Dev/W", p, true);
    const second = await startOneClick("c:" + String.fromCharCode(92) + "dev" + String.fromCharCode(92) + "w" + String.fromCharCode(92), p, true);
    expect(second.state).toBe("running");
    expect(p.status).toHaveBeenCalledTimes(1);
    expect(oneClickRun("c:/dev/w/")?.dir).toBe("C:/Dev/W");
    await vi.waitFor(() => expect(p.commit).toHaveBeenCalled());
    release({ id: "abc", blocked: false, output: "" });
    await first;
  });
  it("publishes a branch with no upstream and plain-pushes one that is ahead", () => {
    expect(pushFor(status())).toEqual({ action: "publish" });
    expect(pushFor(status({ upstream: "origin/x", ahead: 2 }))).toEqual({ action: "push" });
    expect(pushFor(status({ upstream: "origin/x" }))).toEqual({ action: null });
  });
  it("forces with lease after a rewrite and stops when a sync is needed", () => {
    expect(pushFor(status({ upstream: "origin/x", behind: 1, ahead: 1, rewritten: true }))).toEqual({ action: "force" });
    expect(pushFor(status({ upstream: "origin/x", behind: 3 }))).toEqual({ stop: "Sync first: the remote has 3 commits this copy lacks" });
  });
  it("stops with the sync message before writing any text", async () => {
    const p = ports({}, [status({ upstream: "origin/user/work", behind: 2 })]);
    const run = await startOneClick("C:/w", p, true);
    expect(run.state).toBe("failed");
    expect(run.message).toMatch(/^Sync first/);
    expect(run.step).toBe("push");
    expect(p.text).not.toHaveBeenCalled();
  });
  it("stops when the branch changed while the text was being written", async () => {
    const same = status({ upstream: "origin/user/work" });
    const p = ports({}, [same, same, status({ upstream: "origin/user/work", head: "other" })]);
    const run = await startOneClick("C:/w", p, true);
    expect(run.state).toBe("failed");
    expect(run.message).toMatch(/changed while the review text/);
    expect(p.create).not.toHaveBeenCalled();
  });
  it("skips message and commit on a clean branch and names the push step by kind", async () => {
    const p = ports({}, [status()]);
    const run = await startOneClick("C:/w", p, true);
    expect(run.skipped).toEqual(["message", "commit"]);
    expect(p.commit).not.toHaveBeenCalled();
    expect(p.remote).toHaveBeenCalledWith("C:/w", "publish");
    expect(stepWord({ step: "push", push: "publish" })).toBe("Publishing the branch");
    expect(stepWord({ step: "push", push: "force" })).toMatch(/force with lease/);
  });
  it("falls back to a plain message when the writer fails, and reports a failed push", async () => {
    const p = ports({ message: vi.fn(async () => Promise.reject("no agent")), remote: vi.fn(async () => ({ ok: false, output: "rejected" })) });
    const run = await startOneClick("C:/w", p, true);
    expect(p.commit).toHaveBeenCalledWith("C:/w", "Work on user/work");
    expect(run.message).toBe("The push failed, so no pull request was created: rejected");
  });
  it("refuses the default branch, conflicts and a blocked commit", async () => {
    expect(blocker(status({ branch: "main", base: "origin/main" }))).toBe("Move to a feature branch first");
    expect(blocker(status({ conflicts: [ch("x")] }))).toBe("Resolve the conflicts first");
    const p = ports({ commit: vi.fn(async () => ({ id: null, blocked: true, output: "hook said no" })) });
    expect((await startOneClick("C:/w", p, true)).message).toMatch(/hook said no/);
  });
  it("keeps a second start from doubling a running flow, and runs per folder", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    const slow = ports({ message: vi.fn(async () => (await gate, "m")) });
    const first = startOneClick("C:/a", slow, true);
    await Promise.resolve();
    expect(oneClickRun("C:/a")?.state).toBe("running");
    expect(oneClickRun("C:/b")).toBeNull();
    const second = await startOneClick("C:/a", ports(), true);
    expect(second.state).toBe("running");
    release();
    expect((await first).state).toBe("done");
  });
  // Row 915: with AI off the flow never calls the commit-message or review-text writer.
  it("with AI off it commits with the plain message, pushes, writes no text and stops asking the user to write it", async () => {
    const p = ports();
    const run = await startOneClick("C:/w", p, false);
    expect(p.message).not.toHaveBeenCalled();
    expect(p.text).not.toHaveBeenCalled();
    expect(p.commit).toHaveBeenCalledWith("C:/w", "Work on user/work");
    expect(p.remote).toHaveBeenCalledWith("C:/w", "push");
    expect(p.create).not.toHaveBeenCalled();
    expect(run.state).toBe("failed");
    expect(run.step).toBe("text");
    expect(run.skipped).toContain("message");
    expect(run.message).toMatch(/AI writing is off/);
    expect(run.message).toMatch(/committed and pushed/);
  });
  it("with AI off on a clean branch it still pushes and stops before any writer call", async () => {
    const p = ports({}, [status()]);
    const run = await startOneClick("C:/w", p, false);
    expect(p.remote).toHaveBeenCalledWith("C:/w", "publish");
    expect(p.text).not.toHaveBeenCalled();
    expect(run.state).toBe("failed");
  });
  // Row 915 review item 3: an AI-off stop is the user's own setting, not a failure.
  it("the AI-off stop is shown as a neutral end, not as Stopped with a cross", async () => {
    const run = await startOneClick("C:/w", ports(), false);
    const html = renderToString(createElement(OneClickView, { run }));
    expect(html).toContain("Branch ready for your review text");
    expect(html).not.toContain("Stopped");
    expect(html).not.toContain("×");
    expect(html).not.toContain('data-mark="failed"');
    expect(html).toContain("write the title and description yourself");
    const real = await startOneClick("C:/x", ports({ remote: vi.fn(async () => ({ ok: false, output: "rejected" })) }), false);
    const bad = renderToString(createElement(OneClickView, { run: real }));
    expect(bad).toContain("Stopped");
    expect(bad).toContain('data-mark="failed"');
  });
  it("offers the flow only when there is work to carry", () => {
    expect(needsOneClick(status({ changed: [ch("a")] }))).toBe(true);
    expect(needsOneClick(status({ upstream: "origin/x" }))).toBe(false);
    expect(needsOneClick(status({ upstream: "origin/x", ahead: 1 }))).toBe(true);
    expect(needsOneClick(status({ branch: "main" }))).toBe(false);
    expect(needsOneClick(null)).toBe(false);
  });
  it("renders every step with long names cut to one line", () => {
    const html = renderToString(createElement(OneClickView, { run: { dir: "d", step: "text", state: "running", message: null, pr: null, skipped: ["message"], push: "force" } }));
    for (const id of STEPS) expect(html).toContain(`data-step="${id}"`);
    expect(html).toContain("oc-cut");
    expect(html).toContain('data-mark="now"');
    expect(html).toContain("Pushing the branch (force with lease)");
  });
});

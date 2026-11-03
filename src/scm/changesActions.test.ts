import { describe, expect, it } from "vitest";
import { bulkPaths, oneAtATime, remoteButtons, remoteSay, runRemote, stagePaths, treeWidthForKey, TREE_MAX, TREE_MIN, type Call } from "./changesActions";
import { emptyStatus, type Status } from "./model";

const ch = (path: string) => ({ path, status: "M", from: null });
const st = (over: Partial<Status>): Status => ({ ...emptyStatus, branch: "main", upstream: "origin/main", ...over });

describe("the Changes tab's stage buttons", () => {
  it("stage all takes the changed and new files, never the conflicted ones; unstage all takes the staged", () => {
    const s = st({ staged: [ch("a.ts")], changed: [ch("b.ts")], untracked: [ch("c.ts")], conflicts: [ch("d.ts")] });
    expect(bulkPaths(s, true)).toEqual(["b.ts", "c.ts"]);
    expect(bulkPaths(s, false)).toEqual(["a.ts"]);
    expect(bulkPaths(null, true)).toEqual([]);
  });

  it("sends scm_stage with the worktree, the paths and the direction, and answers null when it worked", async () => {
    const calls: [string, Record<string, unknown>][] = [];
    const call: Call = (cmd, args) => (calls.push([cmd, args]), Promise.resolve(undefined as never));
    expect(await stagePaths(call, "C:/r", ["a.ts"], true)).toBeNull();
    expect(await stagePaths(call, "C:/r", ["a.ts"], false)).toBeNull();
    expect(calls).toEqual([
      ["scm_stage", { worktree: "C:/r", paths: ["a.ts"], on: true }],
      ["scm_stage", { worktree: "C:/r", paths: ["a.ts"], on: false }],
    ]);
    expect(await stagePaths(call, "C:/r", [], true)).toBeNull();
    expect(calls).toHaveLength(2); // nothing to stage: nothing sent
  });

  it("turns a failed stage into an error line", async () => {
    const say = await stagePaths(() => Promise.reject("index.lock exists"), "C:/r", ["a.ts"], true);
    expect(say).toEqual({ text: "Staging failed: index.lock exists", bad: true });
  });
});

describe("the Changes tab's push, pull and sync", () => {
  it("offers three buttons with counts, and says why one waits", () => {
    const b = remoteButtons(st({ ahead: 2, behind: 0 }));
    expect(b.map((x) => x.id)).toEqual(["push", "pull", "sync"]);
    expect(b[0].reason).toBeNull();
    expect(b[1].reason).toBe("Nothing to pull");
    expect(b[2].label).toContain("\u21912");
    expect(remoteButtons(st({ upstream: null })).every((x) => x.reason === "Branch unpublished")).toBe(true);
  });

  it("calls scm_remote with the action and words success and failure", async () => {
    const sent: unknown[] = [];
    const ok: Call = (cmd, args) => (sent.push([cmd, args]), Promise.resolve({ ok: true, output: "" } as never));
    expect(await runRemote(ok, "C:/r", "push", "Push 2 commits")).toEqual({ text: "Push 2 commits: done", bad: false });
    expect(sent).toEqual([["scm_remote", { worktree: "C:/r", action: "push" }]]);
    const refused: Call = () => Promise.resolve({ ok: false, kind: "non-fast-forward", output: "! [rejected] main -> main (fetch first)\nerror: failed to push" } as never);
    const say = await runRemote(refused, "C:/r", "push", "Push");
    expect(say.bad).toBe(true);
    expect(say.text).toContain("Push refused: the remote has commits this copy lacks; pull first");
    expect(say.text).toContain("failed to push");
    const timeout = remoteSay("Pull", { ok: false, kind: "network", output: "git pull timed out after 300 seconds, so Kolux stopped it." });
    expect(timeout.text).toContain("could not be reached");
    expect(timeout.text).toContain("timed out after 300 seconds");
  });

  it("turns a thrown error into a line instead of leaving the button pending", async () => {
    const say = await runRemote(() => Promise.reject("no such command"), "C:/r", "sync", "Sync");
    expect(say).toEqual({ text: "Sync failed: no such command", bad: true });
  });
});

describe("one git action at a time", () => {
  it("ignores a second commit while the first is running and allows the next once it ends", async () => {
    const turn = oneAtATime();
    let sent = 0;
    let release: () => void = () => undefined;
    const slow = () => new Promise<string>((r) => ((sent += 1), (release = () => r("done"))));
    const first = turn.run(slow);
    expect(turn.busy()).toBe(true);
    expect(await turn.run(slow)).toBeUndefined(); // the double click / repeated Ctrl+Enter
    expect(sent).toBe(1);
    release();
    expect(await first).toBe("done");
    expect(turn.busy()).toBe(false);
    const next = turn.run(slow);
    release();
    expect(await next).toBe("done");
    expect(sent).toBe(2);
  });

  it("frees the turn when the work throws", async () => {
    const turn = oneAtATime();
    await expect(turn.run(() => Promise.reject(new Error("x")))).rejects.toThrow("x");
    expect(turn.busy()).toBe(false);
  });
});

describe("the file tree's resize handle", () => {
  it("moves with the arrow keys, stops at its limits, jumps with Home and End and ignores other keys", () => {
    expect(treeWidthForKey(260, "ArrowRight")).toBe(276);
    expect(treeWidthForKey(260, "ArrowLeft")).toBe(244);
    expect(treeWidthForKey(TREE_MIN, "ArrowLeft")).toBe(TREE_MIN);
    expect(treeWidthForKey(TREE_MAX, "ArrowRight")).toBe(TREE_MAX);
    expect(treeWidthForKey(300, "Home")).toBe(TREE_MIN);
    expect(treeWidthForKey(300, "End")).toBe(TREE_MAX);
    expect(treeWidthForKey(300, "a")).toBeNull();
  });
});

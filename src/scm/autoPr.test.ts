import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.hoisted(() => vi.fn(async (..._a: unknown[]) => ({ number: 9 })));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
import { DEFAULT_BODY, enabledFor, onAgentIdle, realAutoPorts, runAutoPr, stopNotice, type AutoPorts, type AutoStep } from "./autoPr";
import { clearOneClick, oneClickRun } from "./oneClick";
import type { Pr, Status } from "./model";

const status = (o: Partial<Status> = {}): Status => ({ branch: "user/work", upstream: "origin/user/work", ahead: 0, behind: 0, rewritten: false, base: "origin/main", head: "h1", staged: [], changed: [], untracked: [], conflicts: [], operation: null, resolved: [], ...o });
const step = (kind: AutoStep["kind"], message = "", files: string[] = []): AutoStep => ({ kind, message, files });
const PR: Pr = { number: 7, url: "https://github.com/o/r/pull/7", state: "OPEN", draft: true };

const ports = (o: Partial<AutoPorts> = {}): AutoPorts => ({
  remote: vi.fn(async () => "github" as const),
  commit: vi.fn(async () => step("done", "committed")),
  push: vi.fn(async () => step("done", "pushed")),
  status: vi.fn(async () => status()),
  find: vi.fn(async () => null),
  write: vi.fn(async () => ["Add the thing", "Why and how"] as [string, string]),
  create: vi.fn(async () => PR),
  ...o,
});

describe("DT-C89 enabledFor", () => {
  it("defaults to GitHub only when nothing is saved", () => {
    expect(enabledFor({}, "C:/w", "github")).toBe(true);
    expect(enabledFor({}, "C:/w", "other")).toBe(false);
    expect(enabledFor({}, "C:/w", "none")).toBe(false);
    expect(enabledFor(null, "C:/w", "github")).toBe(true);
  });
  it("honours the default values on, off and github", () => {
    expect(enabledFor({ autoPr: { default: "on" } }, "C:/w", "none")).toBe(true);
    expect(enabledFor({ autoPr: { default: "on" } }, "C:/w", "other")).toBe(true);
    expect(enabledFor({ autoPr: { default: "off" } }, "C:/w", "github")).toBe(false);
    expect(enabledFor({ autoPr: { default: "github" } }, "C:/w", "other")).toBe(false);
    expect(enabledFor({ autoPr: { default: "nonsense" } }, "C:/w", "github")).toBe(true);
  });
  it("lets the workspace's own choice win, folders compared case-insensitively with / and backslash alike", () => {
    expect(enabledFor({ autoPr: { default: "off", workspaces: { "C:\\Dev\\Work\\": true } } }, "c:/dev/work", "none")).toBe(true);
    expect(enabledFor({ autoPr: { default: "on", workspaces: { "c:/dev/work": false } } }, "C:\\Dev\\Work", "github")).toBe(false);
    expect(enabledFor({ autoPr: { default: "off", workspaces: { "C:/other": true } } }, "C:/dev/work", "github")).toBe(false);
    expect(enabledFor({ autoPr: { workspaces: { "C:/w": "yes" } } }, "C:/w", "github")).toBe(true);
  });
});

describe("T-653 runAutoPr", () => {
  beforeEach(() => clearOneClick());

  it("commits, pushes and opens a draft pull request with the writer's text", async () => {
    const p = ports();
    const run = await runAutoPr("C:/w", p);
    expect(run.state).toBe("done");
    expect(run.pr?.number).toBe(7);
    expect(p.create).toHaveBeenCalledWith("C:/w", "Add the thing", "Why and how", "main", true);
    expect(oneClickRun("C:/w")?.auto?.kind).toBe("done");
  });

  it("uses the branch name and the plain line when the AI gate is closed", async () => {
    const p = ports({ write: vi.fn(async () => null) });
    const run = await runAutoPr("C:/w", p);
    expect(run.state).toBe("done");
    expect(p.create).toHaveBeenCalledWith("C:/w", "user/work", DEFAULT_BODY, "main", true);
    expect(run.skipped).toContain("text");
  });

  it("falls back to the plain text when the writer fails", async () => {
    const p = ports({ write: vi.fn(async () => Promise.reject(new Error("writer down"))) });
    const run = await runAutoPr("C:/w", p);
    expect(run.state).toBe("done");
    expect(p.create).toHaveBeenCalledWith("C:/w", "user/work", DEFAULT_BODY, "main", true);
  });

  it("existing open pull request: pushes only, writes nothing, creates nothing", async () => {
    const p = ports({ find: vi.fn(async () => PR) });
    const run = await runAutoPr("C:/w", p);
    expect(run.state).toBe("done");
    expect(run.pr).toBe(PR);
    expect(p.write).not.toHaveBeenCalled();
    expect(p.create).not.toHaveBeenCalled();
  });

  it("commit clean goes on to push", async () => {
    const p = ports({ commit: vi.fn(async () => step("clean")) });
    const run = await runAutoPr("C:/w", p);
    expect(p.push).toHaveBeenCalled();
    expect(run.state).toBe("done");
  });

  it.each(["skipped", "blocked", "failed"] as const)("commit %s stops, keeping kind, message and files", async (kind) => {
    const p = ports({ commit: vi.fn(async () => step(kind, "stopped here", [".env", "a.pem"])) });
    const run = await runAutoPr("C:/w", p);
    expect(run.state).toBe("failed");
    expect(run.message).toBe("stopped here");
    expect(run.auto).toMatchObject({ kind, files: [".env", "a.pem"] });
    expect(run.neutral).toBe(kind === "skipped");
    expect(p.push).not.toHaveBeenCalled();
  });

  it.each(["skipped", "blocked", "failed"] as const)("push %s stops before any pull request step", async (kind) => {
    const p = ports({ push: vi.fn(async () => step(kind, "sync first", ["big.bin"])) });
    const run = await runAutoPr("C:/w", p);
    expect(run.state).toBe("failed");
    expect(run.auto).toMatchObject({ kind, files: ["big.bin"] });
    expect(run.step).toBe("push");
    expect(p.find).not.toHaveBeenCalled();
    expect(p.create).not.toHaveBeenCalled();
  });

  it("push local finishes as local-only with no pull request step", async () => {
    const p = ports({ remote: vi.fn(async () => "none" as const), push: vi.fn(async () => step("local", "No remote")) });
    const run = await runAutoPr("C:/w", p);
    expect(run.state).toBe("done");
    expect(run.auto).toMatchObject({ kind: "local", local: true });
    expect(p.find).not.toHaveBeenCalled();
    expect(p.create).not.toHaveBeenCalled();
  });

  it("a local-only turn with nothing to commit leaves no trace", async () => {
    const p = ports({ commit: vi.fn(async () => step("clean")), push: vi.fn(async () => step("local")) });
    await runAutoPr("C:/w", p, "none");
    expect(oneClickRun("C:/w")).toBeNull();
  });

  it("a clean push with no open pull request finishes quietly and keeps the earlier run", async () => {
    const first = await runAutoPr("C:/w", ports({ find: vi.fn(async () => PR) }));
    const p = ports({ commit: vi.fn(async () => step("clean")), push: vi.fn(async () => step("clean")) });
    const run = await runAutoPr("C:/w", p);
    expect(run).toEqual(first);
    expect(oneClickRun("C:/w")).toEqual(first);
    expect(p.create).not.toHaveBeenCalled();
    clearOneClick();
    await runAutoPr("C:/x", p);
    expect(oneClickRun("C:/x")).toBeNull();
  });

  it("another host gets commits and a push but no pull request", async () => {
    const p = ports({ remote: vi.fn(async () => "other" as const) });
    const run = await runAutoPr("C:/w", p);
    expect(run.state).toBe("done");
    expect(p.push).toHaveBeenCalled();
    expect(p.find).not.toHaveBeenCalled();
    expect(p.create).not.toHaveBeenCalled();
  });

  it("a second start while the first runs does nothing", async () => {
    let release: (s: AutoStep) => void = () => {};
    const p = ports({ commit: vi.fn(() => new Promise<AutoStep>((r) => (release = r))) });
    const first = runAutoPr("C:/w", p);
    const second = await runAutoPr("C:/w", p);
    expect(second.state).toBe("running");
    expect(p.commit).toHaveBeenCalledTimes(1);
    release(step("clean"));
    await first;
    expect(p.push).toHaveBeenCalledTimes(1);
  });

  it("a thrown error or failed lookup ends the run as failed, not retried", async () => {
    const p = ports({ create: vi.fn(async () => Promise.reject(new Error("gh is not signed in"))) });
    const run = await runAutoPr("C:/w", p);
    expect(run.state).toBe("failed");
    expect(run.message).toContain("gh is not signed in");
    expect(p.create).toHaveBeenCalledTimes(1);
    const q = ports({ find: vi.fn(async () => Promise.reject(new Error("rate limited"))) });
    const lookup = await runAutoPr("C:/y", q);
    expect(lookup.message).toMatch(/pushed, but the pull request lookup failed.*rate limited/);
    expect(q.create).not.toHaveBeenCalled();
  });
});

describe("T-653 review fixes", () => {
  beforeEach(() => clearOneClick());

  it("the real create port never lets the back end push (push: false) and asks for a draft", async () => {
    invoke.mockClear();
    await realAutoPorts.create("C:/w", "T", "B", "main", true);
    expect(invoke).toHaveBeenCalledWith("scm_pr_create", { worktree: "C:/w", title: "T", body: "B", base: "main", draft: true, push: false });
  });

  it("folders that differ only in case or slash style exclude each other", async () => {
    let release: (s: AutoStep) => void = () => {};
    const p = ports({ commit: vi.fn(() => new Promise<AutoStep>((r) => (release = r))) });
    const first = runAutoPr("C:/Dev/W", p);
    const second = await runAutoPr("c:" + String.fromCharCode(92) + "dev" + String.fromCharCode(92) + "w/", p);
    expect(second.state).toBe("running");
    expect(p.commit).toHaveBeenCalledTimes(1);
    expect(oneClickRun("c:/dev/w")?.state).toBe("running");
    release(step("clean"));
    await first;
  });

  it("a turn clean on both steps drops the earlier stopped run, and keeps an earlier success", async () => {
    await runAutoPr("C:/w", ports({ commit: vi.fn(async () => step("blocked", "A likely secret.", [".env"])) }));
    expect(oneClickRun("C:/w")?.auto?.kind).toBe("blocked");
    const clean = ports({ commit: vi.fn(async () => step("clean")), push: vi.fn(async () => step("clean")) });
    await runAutoPr("C:/w", clean);
    expect(oneClickRun("C:/w")).toBeNull();
    const ok = await runAutoPr("C:/v", ports({ find: vi.fn(async () => PR) }));
    await runAutoPr("C:/v", clean);
    expect(oneClickRun("C:/v")).toEqual(ok);
  });
});

describe("T-653 onAgentIdle", () => {
  beforeEach(() => clearOneClick());
  const deps = (p: AutoPorts, settings: Record<string, unknown> | null = {}) => ({ settings: vi.fn(async () => settings), ports: p, notice: vi.fn() });

  it("does nothing when the setting is off for the folder", async () => {
    const p = ports();
    expect(await onAgentIdle("C:/w", deps(p, { autoPr: { default: "off" } }))).toBeNull();
    expect(p.commit).not.toHaveBeenCalled();
  });

  it("does nothing when the settings cannot be read", async () => {
    const p = ports();
    expect(await onAgentIdle("C:/w", deps(p, null))).toBeNull();
    expect(p.remote).not.toHaveBeenCalled();
  });

  it("tells the user about a blocked stop, naming the files", async () => {
    const p = ports({ commit: vi.fn(async () => step("blocked", "A likely secret.", [".env"])) });
    const d = deps(p);
    await onAgentIdle("C:/dev/w", d);
    expect(d.notice).toHaveBeenCalledTimes(1);
    expect(d.notice.mock.calls[0][0]).toMatch(/stopped in w: A likely secret\. Files: \.env\./);
  });

  it("says nothing for a skipped stop or a success", async () => {
    const d1 = deps(ports({ commit: vi.fn(async () => step("skipped", "default branch")) }));
    await onAgentIdle("C:/w", d1);
    const d2 = deps(ports());
    await onAgentIdle("C:/v", d2);
    expect(d1.notice).not.toHaveBeenCalled();
    expect(d2.notice).not.toHaveBeenCalled();
  });

  it("a second finish while the first is still working is ignored", async () => {
    let release: (s: AutoStep) => void = () => {};
    const p = ports({ commit: vi.fn(() => new Promise<AutoStep>((r) => (release = r))) });
    const d = deps(p);
    const first = onAgentIdle("C:/w", d);
    expect(await onAgentIdle("c:\\W\\", d)).toBeNull();
    await vi.waitFor(() => expect(p.commit).toHaveBeenCalled());
    await vi.waitFor(() => expect(p.commit).toHaveBeenCalled());
    release(step("clean"));
    await first;
    expect(p.commit).toHaveBeenCalledTimes(1);
  });

  it("stopNotice lists at most five files", () => {
    const run = { dir: "C:/dev/w", message: "Stopped.", auto: { kind: "blocked", files: ["1", "2", "3", "4", "5", "6", "7"], local: false } } as never;
    expect(stopNotice(run)).toContain("Files: 1, 2, 3, 4, 5 and 2 more.");
  });
});

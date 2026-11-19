import { describe, expect, it, vi } from "vitest";
import type { Check } from "../scm/checks";
import type { WorkItem } from "../projects/model";
import { carryLine, carryPrompt, runCarry, type CarryContext } from "./carry";
import { failingChecks, fixChecksPrompt, FIX_LIST_MAX, runFixChecks } from "./fixChecks";
import { itemPrompt, itemUrl, runFromItem } from "./fromItem";
import { parseArgs, pickSaved, pickTarget, startChecked, targetBlock, type Launch, type StartAgent } from "./rules";

const agents: StartAgent[] = [
  { id: "claude", name: "Claude Code", installed: true },
  { id: "codex", name: "Codex", installed: true },
  { id: "amp", name: "Amp", installed: false },
];
const ok: Launch = async () => ({ handed: true });
const here = async () => {};
const gone = async (dir: string) => {
  throw new Error(`${dir} no longer exists, so no agent was started.`);
};
const ctx: CarryContext = { agent: "claude", id: "s1", title: "Fix login", dir: "C:/work/app", turns: 2, text: "User: fix login\n\nAssistant: done", trimmed: false, omitted: 0 };

describe("SESS-031 which agent the dialog pre-selects", () => {
  it("takes the source agent while it is available, else the saved default, else the first available", () => {
    expect(pickTarget(agents, "claude", "codex")?.id).toBe("claude");
    expect(pickTarget(agents, "amp", "codex")?.id).toBe("codex");
    expect(pickTarget(agents, "amp", "amp")?.id).toBe("claude");
    expect(pickTarget(agents, undefined, "")?.id).toBe("claude");
    expect(pickTarget([{ id: "amp", name: "Amp", installed: false }], "amp", "amp")).toBeNull();
    expect(pickTarget([], "claude", "claude")).toBeNull();
  });
  it("names an unavailable target", () => {
    expect(targetBlock(agents, "amp", "Amp")).toBe("Amp is not installed or is switched off, so nothing was started.");
    expect(targetBlock(agents, "codex")).toBeNull();
  });
  it("never lets a saved agent that is gone be the one launched", () => {
    expect(pickSaved(agents, "amp", "codex")?.id).toBe("codex");
    expect(pickSaved(agents, "codex", "claude")?.id).toBe("codex");
    expect(pickSaved(agents, 42, "")?.id).toBe("claude");
    expect(pickSaved([], "claude", "claude")).toBeNull();
  });
});

describe("SESS-034 per-launch arguments", () => {
  it("splits plain options and keeps quoted words together", () => {
    expect(parseArgs("")).toEqual({ args: [] });
    expect(parseArgs("--model opus --effort high")).toEqual({ args: ["--model", "opus", "--effort", "high"] });
    expect(parseArgs('--append "two words" \'a b\'')).toEqual({ args: ["--append", "two words", "a b"] });
    expect(parseArgs('--x ""')).toEqual({ args: ["--x", ""] });
  });
  it("refuses line breaks, open quotes, long text and characters a shell would act on", () => {
    expect(parseArgs("--a\n--b")).toEqual({ error: "The launch arguments must be on one line." });
    expect(parseArgs('--a "open')).toEqual({ error: "The launch arguments have a quote that is never closed." });
    expect(parseArgs("x".repeat(1001))).toEqual({ error: "The launch arguments are too long." });
    for (const bad of ["--a && calc", "--a | b", "--a ; b", "--a > f", "--a `b`", "--a $HOME", "--a %PATH%", "--a ^b"]) expect("error" in parseArgs(bad)).toBe(true);
  });
});

describe("startChecked reports each failing step apart", () => {
  const agent = agents[0];
  it("never launches into a folder that is gone", async () => {
    const launch = vi.fn(ok);
    const r = await startChecked({ agent, dir: "C:/gone", prompt: "p", what: "x", ready: gone, launch });
    expect(r).toEqual({ ok: false, stage: "folder", message: "C:/gone no longer exists, so no agent was started." });
    expect(launch).not.toHaveBeenCalled();
  });
  it("tells a failed launch from a failed hand-over of the prompt", async () => {
    const launch: Launch = async () => {
      throw new Error("claude could not be run");
    };
    expect(await startChecked({ agent, dir: "C:/a", prompt: "p", what: "the earlier conversation", ready: here, launch })).toEqual({ ok: false, stage: "launch", message: "Claude Code did not start: claude could not be run" });
    const r = await startChecked({ agent, dir: "C:/a", prompt: "p", what: "the earlier conversation", ready: here, launch: async () => ({ handed: false }) });
    expect(r).toEqual({ ok: false, stage: "prompt", message: "Claude Code started, but the earlier conversation could not be handed over to it." });
  });
  it("passes the agent, folder, prompt and extra arguments to the launch", async () => {
    const launch = vi.fn(ok);
    const r = await startChecked({ agent, dir: "C:/a", prompt: "hello", extra: ["--x"], what: "w", ready: here, launch });
    expect(r).toEqual({ ok: true, dir: "C:/a", agent: "claude" });
    expect(launch).toHaveBeenCalledWith("claude", "C:/a", "hello", ["--x"]);
  });
});

describe("SESS-031 / VIEW-087 carrying a conversation", () => {
  it("opens the new session with the transcript, the source agent and where it ran", () => {
    const p = carryPrompt(ctx, "Claude Code", "C:/work/app");
    expect(p).toContain('earlier conversation with Claude Code ("Fix login")');
    expect(p).toContain("worked in C:/work/app");
    expect(p).toContain("--- earlier conversation ---\nUser: fix login\n\nAssistant: done\n--- end of earlier conversation ---");
    expect(p).not.toContain("trimmed");
    expect(carryPrompt({ ...ctx, trimmed: true, title: "" }, "Codex", "C:/x")).toContain("It is trimmed");
  });
  it("continue a Claude session in Codex: Codex starts in the session's own folder with the transcript", async () => {
    const launch = vi.fn(ok);
    const r = await runCarry({ ctx, agents, targetId: "codex", workspace: "C:/other", ready: here, launch });
    expect(r).toEqual({ ok: true, dir: "C:/work/app", agent: "codex" });
    const [agent, dir, prompt] = launch.mock.calls[0];
    expect([agent, dir]).toEqual(["codex", "C:/work/app"]);
    expect(prompt).toContain("User: fix login");
  });
  it("continue a Claude session with Claude starts a new session in the original working folder", async () => {
    const launch = vi.fn(ok);
    const r = await runCarry({ ctx, agents, targetId: "claude", workspace: "C:/other", ready: here, launch });
    expect(r).toMatchObject({ ok: true, dir: "C:/work/app", agent: "claude" });
  });
  it("falls back to the workspace in front when the session's folder is gone, and stops when neither is there", async () => {
    const onlyOther = async (d: string) => {
      if (d !== "C:/other") throw new Error("gone");
    };
    const launch = vi.fn(ok);
    expect(await runCarry({ ctx, agents, targetId: "claude", workspace: "C:/other", ready: onlyOther, launch })).toMatchObject({ ok: true, dir: "C:/other" });
    expect(launch.mock.calls[0][2]).toContain("worked in C:/work/app");
    launch.mockClear();
    const r = await runCarry({ ctx, agents, targetId: "claude", workspace: null, ready: gone, launch });
    expect(r).toMatchObject({ ok: false, stage: "folder" });
    expect(launch).not.toHaveBeenCalled();
  });
  it("a target that was just uninstalled launches nothing", async () => {
    const launch = vi.fn(ok);
    const r = await runCarry({ ctx, agents, targetId: "amp", workspace: null, ready: here, launch });
    expect(r).toEqual({ ok: false, stage: "agent", message: "Amp is not installed or is switched off, so nothing was started." });
    expect(launch).not.toHaveBeenCalled();
    expect(await runCarry({ ctx, agents: [], targetId: "claude", workspace: null, ready: here, launch })).toMatchObject({ ok: false, stage: "agent" });
  });
  it("words the dialog line for the same agent and a different one", () => {
    expect(carryLine("Claude Code", true)).toContain("A new Claude Code session");
    expect(carryLine("Claude Code", false)).toContain("earlier Claude Code conversation");
  });
});

const failed = (name: string, extra: Partial<Check> = {}): Check => ({ name, outcome: "failed", ...extra });
const pr = { number: 7, title: "Add login", url: "https://github.com/acme/app/pull/7" };

describe("SESS-033 start an agent on failing checks", () => {
  it("counts failed and outcome-less checks, nothing else", () => {
    const checks: Check[] = [failed("lint"), { name: "unit", outcome: "passed" }, { name: "e2e", outcome: "unresolved" }, { name: "docs", outcome: "running" }, { name: "x", outcome: "skipped" }];
    expect(failingChecks(checks).map((c) => c.name)).toEqual(["lint", "e2e"]);
  });
  it("the task names each failing check with its workflow, what it said and its link", () => {
    const p = fixChecksPrompt(pr, [failed("lint", { workflow: "ci", description: "2 errors\nin a.ts", link: "https://x/1" }), { name: "e2e", outcome: "unresolved" }]);
    expect(p).toContain('Pull request #7 "Add login" (https://github.com/acme/app/pull/7) has 2 failing checks');
    expect(p).toContain("- lint (workflow ci; 2 errors in a.ts; details: https://x/1)");
    expect(p).toContain("- e2e (finished without reporting an outcome)");
    expect(fixChecksPrompt(pr, [failed("a")])).toContain("has a failing check");
  });
  it("names at most the first checks and counts the rest", () => {
    const many = Array.from({ length: FIX_LIST_MAX + 5 }, (_, i) => failed(`job-${i}`));
    const p = fixChecksPrompt(pr, many);
    expect(p).toContain("- job-0");
    expect(p).not.toContain(`- job-${FIX_LIST_MAX}\n`);
    expect(p).toContain("and 5 more failing checks");
  });
  const base = { dir: "C:/ws", pr, checks: [failed("lint")], agents, saved: undefined, defaultId: "codex", ready: here };
  it("click fix on a worktree with a failing check: an agent starts there with the failure details", async () => {
    const launch = vi.fn(ok);
    const r = await runFixChecks({ ...base, launch });
    expect(r).toEqual({ ok: true, dir: "C:/ws", agent: "codex" });
    expect(launch.mock.calls[0][2]).toContain("- lint");
  });
  it("uses the agent saved for agent actions while it is available", async () => {
    const launch = vi.fn(ok);
    await runFixChecks({ ...base, saved: "claude", launch });
    expect(launch.mock.calls[0][0]).toBe("claude");
  });
  it("nothing starts when every agent is off, the worktree is gone, or there is nothing to fix", async () => {
    const launch = vi.fn(ok);
    expect(await runFixChecks({ ...base, agents: [], launch })).toMatchObject({ ok: false, stage: "agent", message: "No agent is installed and switched on, so nothing was started." });
    expect(await runFixChecks({ ...base, ready: gone, launch })).toMatchObject({ ok: false, stage: "folder" });
    expect(await runFixChecks({ ...base, dir: null, launch })).toMatchObject({ ok: false, stage: "folder" });
    expect(await runFixChecks({ ...base, pr: null, launch })).toMatchObject({ ok: false });
    expect(await runFixChecks({ ...base, checks: [{ name: "a", outcome: "passed" }], launch })).toMatchObject({ ok: false, message: "No check is failing on this pull request." });
    expect(launch).not.toHaveBeenCalled();
  });
  it("saved arguments that are invalid make the launch fail and the result says so", async () => {
    const launch: Launch = async () => {
      throw new Error("The saved arguments for claude are not valid.");
    };
    const r = await runFixChecks({ ...base, launch });
    expect(r).toEqual({ ok: false, stage: "launch", message: "Codex did not start: The saved arguments for claude are not valid." });
  });
});

const issue: WorkItem = { host: "github.com", owner: "acme", repo: "app", kind: "issue", number: 12 };
const pull: WorkItem = { ...issue, kind: "pull", number: 3 };

describe("SESS-034 start an agent from an issue or pull request", () => {
  it("addresses the item on its host and gives the agent the item as its opening prompt", () => {
    expect(itemUrl(issue)).toBe("https://github.com/acme/app/issues/12");
    expect(itemUrl({ ...pull, host: "git.corp.example" })).toBe("https://git.corp.example/acme/app/pull/3");
    const p = itemPrompt(issue, "Login   fails\non Safari");
    expect(p).toContain('Work on issue #12 "Login fails on Safari" in acme/app (https://github.com/acme/app/issues/12)');
    expect(p).toContain("gh issue view 12");
    expect(itemPrompt(pull, "Add login")).toContain("This workspace is on the pull request's own branch");
    expect(itemPrompt(issue, "x".repeat(500))).toContain("…");
  });
  const base = { title: "Login fails", agents, saved: undefined, defaultId: "claude", argsText: "", existing: null, ready: here };
  it("makes the workspace, then starts the agent in it with the item", async () => {
    const make = vi.fn(async () => ({ path: "C:/ws/issue-12" }));
    const launch = vi.fn(ok);
    const r = await runFromItem({ ...base, item: issue, makeWorkspace: make, launch });
    expect(r).toEqual({ ok: true, dir: "C:/ws/issue-12", agent: "claude" });
    expect(launch.mock.calls[0].slice(0, 2)).toEqual(["claude", "C:/ws/issue-12"]);
    expect(launch.mock.calls[0][2]).toContain("issue #12");
  });
  it("uses the workspace that already belongs to the item instead of making a second", async () => {
    const make = vi.fn(async () => ({ path: "C:/new" }));
    const r = await runFromItem({ ...base, item: pull, existing: "C:/ws/pr-3", makeWorkspace: make, launch: ok });
    expect(r).toMatchObject({ ok: true, dir: "C:/ws/pr-3" });
    expect(make).not.toHaveBeenCalled();
  });
  it("refuses bad per-launch arguments before any workspace is made", async () => {
    const make = vi.fn(async () => ({ path: "C:/new" }));
    const launch = vi.fn(ok);
    const r = await runFromItem({ ...base, item: issue, argsText: "--x && calc", makeWorkspace: make, launch });
    expect(r).toMatchObject({ ok: false, stage: "arguments" });
    expect(make).not.toHaveBeenCalled();
    expect(launch).not.toHaveBeenCalled();
  });
  it("hands good per-launch arguments to the launch", async () => {
    const launch = vi.fn(ok);
    await runFromItem({ ...base, item: issue, argsText: "--model opus", makeWorkspace: async () => ({ path: "C:/w" }), launch });
    expect(launch.mock.calls[0][3]).toEqual(["--model", "opus"]);
  });
  it("makes no workspace when no agent can run, and never launches a saved agent that is switched off", async () => {
    const make = vi.fn(async () => ({ path: "C:/new" }));
    const launch = vi.fn(ok);
    expect(await runFromItem({ ...base, item: issue, agents: [], makeWorkspace: make, launch })).toMatchObject({ ok: false, stage: "agent" });
    expect(make).not.toHaveBeenCalled();
    await runFromItem({ ...base, item: issue, saved: "amp", defaultId: "codex", makeWorkspace: make, launch });
    expect(launch.mock.calls[0][0]).toBe("codex");
  });
  it("reports a workspace that could not be made and starts no agent", async () => {
    const launch = vi.fn(ok);
    const r = await runFromItem({
      ...base,
      item: pull,
      makeWorkspace: async () => {
        throw new Error("gh could not fetch pull request #3");
      },
      launch,
    });
    expect(r).toEqual({ ok: false, stage: "workspace", message: "gh could not fetch pull request #3" });
    expect(launch).not.toHaveBeenCalled();
  });
});

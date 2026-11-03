// Row 76 (T-226 / VIEW-074 / GIT-024): the AI draft button in the Checks pull request composer.
import { beforeEach, describe, expect, it, vi } from "vitest";

const calls: { cmd: string; args: Record<string, unknown> }[] = [];
let reply: (cmd: string) => unknown = () => ["Add login", "Fixes the login."];
vi.mock("@tauri-apps/api/core", () => ({
  invoke: async (cmd: string, args: Record<string, unknown>) => {
    calls.push({ cmd, args });
    if (cmd === "workspace_details_get") return { name: "Fix login", item: "https://github.com/o/r/issues/12", comment: "" };
    return reply(cmd);
  },
}));

import { writerOf, writerUsable } from "./generate";
import { applyDraft, applyIfUnchanged, draftOffered, draftPrText, draftRunning, draftSubscribe, draftVersion, readDraftGate, settleDraft, startGatedOneClick } from "./prDraft";
import { clearOneClick, type Ports } from "./oneClick";
import type { Status } from "./model";

const typed = { title: "my title", body: "my words", base: "main", draft: false };
const claudeIn = { repo: null, agents: [{ id: "claude", installed: true }] };
const textCalls = () => calls.filter((c) => c.cmd === "scm_pr_text");

describe("row 76 AI draft in the pull request composer", () => {
  beforeEach(() => {
    calls.length = 0;
    reply = () => ["Add login", "Fixes the login."];
  });

  it("asks scm_pr_text for the worktree and base with the saved writer, and fills the title and body", async () => {
    const r = await draftPrText("C:/w", "main", { commitWriter: "claude", commitWriterInstructions: "be brief" }, claudeIn);
    expect(textCalls()).toHaveLength(1);
    expect(textCalls()[0].args).toMatchObject({ worktree: "C:/w", base: "main", command: null, instructions: "be brief", useTemplate: true, agent: "claude", issue: { number: 12, title: "Fix login", body: null } });
    expect(r).toEqual({ state: "filled", title: "Add login", body: "Fixes the login." });
    expect(applyDraft(typed, r)).toEqual({ ...typed, title: "Add login", body: "Fixes the login." });
    expect(draftRunning("C:/w")).toBe(false);
  });

  it("a failure names the problem and leaves what the user typed alone", async () => {
    reply = () => {
      throw new Error("claude is not signed in");
    };
    const r = await draftPrText("C:/w", "main", {}, claudeIn);
    expect(r.state).toBe("failed");
    expect(r.state === "failed" && r.message).toContain("claude is not signed in");
    expect(applyDraft(typed, r)).toBe(typed);
    expect(draftRunning("C:/w")).toBe(false);
  });

  it("a reply with no title is a failure, not a blank fill", async () => {
    reply = () => ["  ", "text"];
    const r = await draftPrText("C:/w", "main", {}, claudeIn);
    expect(r.state).toBe("failed");
    expect(applyDraft(typed, r)).toBe(typed);
  });

  it("while a draft is running a second ask does not call again", async () => {
    let release: (v: [string, string]) => void = () => {};
    reply = () => new Promise<[string, string]>((res) => (release = res));
    const first = draftPrText("C:/w", "main", {}, claudeIn);
    await vi.waitFor(() => expect(textCalls()).toHaveLength(1));
    expect(draftRunning("C:/w")).toBe(true);
    const second = await draftPrText("C:/w", "main", {}, claudeIn);
    expect(second.state).toBe("busy");
    expect(applyDraft(typed, second)).toBe(typed);
    expect(textCalls()).toHaveLength(1);
    expect(draftRunning("C:/other")).toBe(false);
    release(["T", "B"]);
    expect((await first).state).toBe("filled");
    expect(draftRunning("C:/w")).toBe(false);
  });

  it("the button follows the same switches as the Source Control writer controls", () => {
    expect(draftOffered({}, null, claudeIn.agents)).toBe(true);
    expect(draftOffered({ scmAiHidden: true }, null, claudeIn.agents)).toBe(false);
    expect(draftOffered({ scmAiHidden: true, scmRepoAi: { "o/r": "on" } }, "o/r", claudeIn.agents)).toBe(true);
    expect(draftOffered({ scmRepoAi: { "o/r": "off" } }, "o/r", claudeIn.agents)).toBe(false);
    expect(draftOffered({ commitWriter: "off" }, null, claudeIn.agents)).toBe(false);
  });

  // F1: a draft takes ~30 s; the fields stay editable meanwhile and typed text must survive.
  describe("applyIfUnchanged (text typed while the draft ran)", () => {
    const snap = { title: "t0", body: "b0" };
    const filled = { state: "filled", title: "Add login", body: "Fixes it." } as const;
    const cur = { title: "t0", body: "b0", base: "main", draft: false };

    it("fills both fields and says nothing when neither changed", () => {
      expect(applyIfUnchanged(cur, snap, filled)).toEqual({ draft: { ...cur, title: "Add login", body: "Fixes it." }, note: null });
    });
    it("keeps an edited title, fills the untouched description, and says so", () => {
      const out = applyIfUnchanged({ ...cur, title: "mine" }, snap, filled);
      expect(out.draft).toEqual({ ...cur, title: "mine", body: "Fixes it." });
      expect(out.note).toMatch(/title/);
      expect(out.note).not.toMatch(/description/);
    });
    it("keeps an edited description, fills the untouched title, and says so", () => {
      const out = applyIfUnchanged({ ...cur, body: "mine" }, snap, filled);
      expect(out.draft).toEqual({ ...cur, title: "Add login", body: "mine" });
      expect(out.note).toMatch(/description/);
    });
    it("applies nothing when both were edited", () => {
      const edited = { ...cur, title: "x", body: "y" };
      const out = applyIfUnchanged(edited, snap, filled);
      expect(out.draft).toBe(edited);
      expect(out.note).toMatch(/title and description/);
    });
    it("a failed or busy draft changes nothing and adds no note", () => {
      expect(applyIfUnchanged(cur, snap, { state: "failed", message: "no" })).toEqual({ draft: cur, note: null });
      expect(applyIfUnchanged(cur, snap, { state: "busy" })).toEqual({ draft: cur, note: null });
    });
  });

  // F2: the gate is re-checked against the settings read at click time, inside draftPrText.
  it("with the writer switched off after the composer opened, nothing is called", async () => {
    const r = await draftPrText("C:/w", "main", { commitWriter: "off" }, claudeIn);
    expect(r.state).toBe("off");
    expect(textCalls()).toHaveLength(0);
    expect(applyDraft(typed, r)).toBe(typed);
    expect(draftRunning("C:/w")).toBe(false);
  });
  it("with the AI switch off for the repository, nothing is called", async () => {
    const r = await draftPrText("C:/w", "main", { scmRepoAi: { "o/r": "off" } }, { repo: "o/r", agents: claudeIn.agents });
    expect(r.state).toBe("off");
    expect(textCalls()).toHaveLength(0);
  });

  // F3: the Source Control writer also needs the chosen agent installed, or a custom command or recipe.
  it("the chosen agent not installed and no custom command: not offered, nothing called", async () => {
    const none = [{ id: "claude", installed: false }];
    expect(draftOffered({}, null, none)).toBe(false);
    expect(draftOffered({}, null, [])).toBe(false);
    expect(draftOffered({ commitWriter: "codex" }, null, claudeIn.agents)).toBe(false);
    expect(draftOffered({ commitWriter: "codex" }, null, [{ id: "codex", installed: true }])).toBe(true);
    expect(draftOffered({ commitWriter: "custom", commitWriterCommand: "my-writer" }, null, none)).toBe(true);
    expect((await draftPrText("C:/w", "main", {}, { repo: null, agents: none })).state).toBe("off");
    expect(textCalls()).toHaveLength(0);
  });
  it("the Source Control panel and the composer share one usability rule", () => {
    const agents = [{ id: "claude", installed: false }];
    expect(writerUsable(writerOf({}), agents, null)).toBe(false);
    expect(writerUsable(writerOf({}), agents, { agent: null, args: "", template: "x" })).toBe(true);
    expect(writerUsable(writerOf({ commitWriter: "off" }), [{ id: "claude", installed: true }], null)).toBe(false);
  });
});

// Row 915: the one-click path asks the same fresh gate as the draft button.
describe("row 915 one click honours the AI switches", () => {
  const status = (o: Partial<Status> = {}): Status => ({ branch: "user/work", upstream: null, ahead: 0, behind: 0, rewritten: false, base: "origin/main", head: "h1", staged: [], changed: [{ path: "a.txt", status: "M", from: null }], untracked: [], conflicts: [], operation: null, resolved: [], ...o });
  const ports = (): Ports => {
    const seq = [status(), status({ head: "h2", ahead: 1, upstream: "origin/user/work", changed: [] })];
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
    };
  };
  beforeEach(() => clearOneClick());

  it("the writer switched off: no writer call, the work is still committed and pushed", async () => {
    const p = ports();
    const run = await startGatedOneClick("C:/w", { commitWriter: "off" }, claudeIn, p);
    expect(p.message).not.toHaveBeenCalled();
    expect(p.text).not.toHaveBeenCalled();
    expect(p.commit).toHaveBeenCalledWith("C:/w", "Work on user/work");
    expect(p.remote).toHaveBeenCalled();
    expect(p.create).not.toHaveBeenCalled();
    expect(run.state).toBe("failed");
  });
  it("the AI switch off for the repository: no writer call", async () => {
    const p = ports();
    await startGatedOneClick("C:/w", { scmRepoAi: { "o/r": "off" } }, { repo: "o/r", agents: claudeIn.agents }, p);
    expect(p.message).not.toHaveBeenCalled();
    expect(p.text).not.toHaveBeenCalled();
  });
  it("the chosen agent not installed: no writer call", async () => {
    const p = ports();
    await startGatedOneClick("C:/w", {}, { repo: null, agents: [{ id: "claude", installed: false }] }, p);
    expect(p.message).not.toHaveBeenCalled();
    expect(p.text).not.toHaveBeenCalled();
  });
  it("a usable writer: the message and the review text are written as before", async () => {
    const p = ports();
    const run = await startGatedOneClick("C:/w", {}, claudeIn, p);
    expect(p.message).toHaveBeenCalledTimes(1);
    expect(p.text).toHaveBeenCalledTimes(1);
    expect(p.commit).toHaveBeenCalledWith("C:/w", "Fix the thing");
    expect(run.state).toBe("done");
  });
});

// Row 915 (a): a draft whose composer was closed and reopened is dropped.
describe("settleDraft (composer session)", () => {
  const snap = { title: "", body: "" };
  const filled = { state: "filled", title: "Add login", body: "Fixes it." } as const;
  const cur = { title: "", body: "", base: "main", draft: false };
  it("same session: the draft fills as applyIfUnchanged does", () => {
    expect(settleDraft(cur, snap, filled, 3, 3)).toEqual({ draft: { ...cur, title: "Add login", body: "Fixes it." }, note: null });
  });
  it("the composer was closed and reopened (new session): nothing fills it and no edit note appears", () => {
    expect(settleDraft(cur, snap, filled, 3, 4)).toEqual({ draft: cur, note: null });
    expect(settleDraft({ ...cur, title: "typed" }, snap, filled, 3, 4)).toEqual({ draft: { ...cur, title: "typed" }, note: null });
  });
  it("the composer is closed (no draft): nothing to fill", () => {
    expect(settleDraft(null, snap, filled, 3, 3)).toEqual({ draft: null, note: null });
  });
});

// Row 915 review item 1: a settings read that fails shuts the gate; it must not read as "no settings = AI on".
describe("readDraftGate fails closed", () => {
  const settingsFails = (cmd: string) => {
    if (cmd === "get_settings") throw new Error("settings unreadable");
    if (cmd === "agent_list") return [{ id: "claude", installed: true }];
    if (cmd === "scm_github_repo") return null;
    return ["Add login", "Fixes the login."];
  };
  beforeEach(() => {
    calls.length = 0;
    clearOneClick();
  });
  it("the draft button path: a settings read failure calls no writer", async () => {
    reply = settingsFails;
    const { settings, gate } = await readDraftGate("C:/w");
    expect(draftOffered(settings, gate.repo, gate.agents)).toBe(false);
    expect((await draftPrText("C:/w", "main", settings, gate)).state).toBe("off");
    expect(textCalls()).toHaveLength(0);
  });
  it("the one-click path: a settings read failure calls no writer", async () => {
    reply = settingsFails;
    const { settings, gate } = await readDraftGate("C:/w");
    const p = {
      status: vi.fn(async () => ({ branch: "b", upstream: null, ahead: 0, behind: 0, rewritten: false, base: "origin/main", head: "h", staged: [], changed: [{ path: "a", status: "M", from: null }], untracked: [], conflicts: [], operation: null, resolved: [] }) as Status),
      stage: vi.fn(async () => undefined),
      message: vi.fn(async () => "m"),
      commit: vi.fn(async () => ({ id: "x", blocked: false, output: "" })),
      remote: vi.fn(async () => ({ ok: true, output: "" })),
      text: vi.fn(async () => ["T", "B"] as [string, string]),
      create: vi.fn(),
    } as unknown as Ports;
    await startGatedOneClick("C:/w", settings, gate, p);
    expect(p.message).not.toHaveBeenCalled();
    expect(p.text).not.toHaveBeenCalled();
    expect(calls.filter((c) => c.cmd === "scm_commit_message" || c.cmd === "scm_pr_text")).toHaveLength(0);
  });
  it("a readable settings file opens the gate as before", async () => {
    reply = (cmd) => (cmd === "get_settings" ? {} : cmd === "agent_list" ? [{ id: "claude", installed: true }] : null);
    const { settings, gate } = await readDraftGate("C:/w");
    expect(draftOffered(settings, gate.repo, gate.agents)).toBe(true);
  });
});

// Row 915 review item 2: the running state lives in the module, so a remounted composer sees the true state.
describe("draft running state is shared, never stuck", () => {
  beforeEach(() => {
    calls.length = 0;
    reply = () => ["Add login", "Fixes the login."];
  });
  it("subscribers hear a start and the finish; a late subscriber reads the truth from draftRunning", async () => {
    let release: (v: [string, string]) => void = () => {};
    reply = () => new Promise<[string, string]>((res) => (release = res));
    const v0 = draftVersion();
    const first = draftPrText("C:/w", "main", {}, claudeIn);
    await vi.waitFor(() => expect(textCalls()).toHaveLength(1));
    expect(draftVersion()).toBeGreaterThan(v0);
    expect(draftRunning("C:/w")).toBe(true);
    const heard = vi.fn();
    const off = draftSubscribe(heard); // a remounted composer
    const second = await draftPrText("C:/w", "main", {}, claudeIn);
    expect(second.state).toBe("busy");
    expect(heard).not.toHaveBeenCalled(); // a busy answer changes nothing
    expect(draftRunning("C:/w")).toBe(true);
    release(["T", "B"]);
    await first;
    expect(heard).toHaveBeenCalled();
    expect(draftRunning("C:/w")).toBe(false);
    off();
  });
  it("an off answer starts nothing and notifies nobody", async () => {
    const heard = vi.fn();
    const off = draftSubscribe(heard);
    await draftPrText("C:/w", "main", { commitWriter: "off" }, claudeIn);
    expect(heard).not.toHaveBeenCalled();
    off();
  });
});

// Row 917: the gate keys the per-repository switch by the provider-neutral id, and fails closed over a saved off.
describe("readDraftGate repository id", () => {
  const agents = [{ id: "claude", installed: true }];
  const answer = (settings: Record<string, unknown>, id: unknown) => (cmd: string) => {
    if (cmd === "get_settings") return settings;
    if (cmd === "agent_list") return agents;
    if (cmd === "scm_repo_id") {
      if (id instanceof Error) throw id;
      return id;
    }
    return null;
  };
  beforeEach(() => {
    calls.length = 0;
    clearOneClick();
  });
  it("a GitLab repository switched off is honoured by the draft button", async () => {
    reply = answer({ scmRepoAi: { "gitlab.com/g/app": "off" } }, { id: "gitlab.com/g/app", legacy: null });
    const { settings, gate } = await readDraftGate("C:/w");
    expect(calls.filter((c) => c.cmd === "scm_repo_id")).toHaveLength(1);
    expect(draftOffered(settings, gate.repo, gate.agents)).toBe(false);
    expect((await draftPrText("C:/w", "main", settings, gate)).state).toBe("off");
    expect(textCalls()).toHaveLength(0);
  });
  it("a repository with no remote is keyed by its root path", async () => {
    reply = answer({ scmRepoAi: { "C:/work/proj": "off" } }, { id: "C:/work/proj", legacy: null });
    const { settings, gate } = await readDraftGate("C:/work/proj");
    expect(draftOffered(settings, gate.repo, gate.agents)).toBe(false);
  });
  it("an off saved under the old GitHub key is still honoured", async () => {
    reply = answer({ scmRepoAi: { "Acme/app": "off" } }, { id: "github.com/Acme/app", legacy: "Acme/app" });
    const { settings, gate } = await readDraftGate("C:/w");
    expect(draftOffered(settings, gate.repo, gate.agents)).toBe(false);
  });
  it("an id read that fails keeps AI off while any repository is switched off", async () => {
    reply = answer({ scmRepoAi: { "gitlab.com/g/app": "off" } }, new Error("git failed"));
    const { settings, gate } = await readDraftGate("C:/w");
    expect(gate.repo).toBeNull();
    expect(draftOffered(settings, gate.repo, gate.agents)).toBe(false);
    expect((await draftPrText("C:/w", "main", settings, gate)).state).toBe("off");
  });
  it("an id read that fails with nothing switched off follows the global switch", async () => {
    reply = answer({}, new Error("git failed"));
    const { settings, gate } = await readDraftGate("C:/w");
    expect(draftOffered(settings, gate.repo, gate.agents)).toBe(true);
  });
});

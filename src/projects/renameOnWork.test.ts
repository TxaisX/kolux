import { beforeEach, describe, expect, test } from "vitest";
import type { NamingPorts } from "../scm/autoBranch";
import { forgetRename, onRename, promptTarget, renameOn, renameOnFirstPrompt, type RenameAnswer } from "./renameOnWork";

const openPorts: NamingPorts = { settings: async () => ({}), repo: async () => null };
const ok: RenameAnswer = { renamed: true, reason: null, old: "tx/amber-otter", branch: "tx/fix-login", name: "Fix login", tracking: null };

describe("T-107-d: the first prompt names the branch once", () => {
  beforeEach(() => forgetRename());

  test("both switches must be on", () => {
    expect(renameOn({})).toBe(true);
    expect(renameOn({ renameBranches: false })).toBe(false);
    expect(renameOn({ autoBranchName: false, autoBranchChosen: true })).toBe(false);
    expect(renameOn({ autoBranchName: false })).toBe(true);
  });

  test("asks the back end once per folder with the writer, and never again after an answer", async () => {
    const calls: unknown[] = [];
    const call = (async (cmd: string, args: unknown) => (calls.push([cmd, args]), ok)) as never;
    const seen: unknown[] = [];
    const off = onRename((e) => seen.push(e));
    expect(await renameOnFirstPrompt("C:/w/one", "fix the login bug", {}, call, openPorts)).toEqual(ok);
    expect(calls).toEqual([["workspace_rename_on_first_prompt", { path: "C:/w/one", task: "fix the login bug", writer: { agent: "claude", model: null, effort: null } }]]);
    expect(await renameOnFirstPrompt("C:/w/one", "again", {}, call, openPorts)).toBeNull();
    expect(calls).toHaveLength(1);
    expect(seen).toEqual([{ dir: "C:/w/one", answer: ok, error: null }]);
    off();
    // a refusal from the back end also counts as tried
    const refused = { ...ok, renamed: false, reason: "This workspace has a name of its own, so its branch keeps it." };
    const refuse = (async () => refused) as never;
    expect(await renameOnFirstPrompt("C:/w/two", "task", {}, refuse, openPorts)).toEqual(refused);
    expect(await renameOnFirstPrompt("C:/w/two", "task", {}, call, openPorts)).toBeNull();
    expect(calls).toHaveLength(1);
  });

  test("a switch that is off, a blank task or a writer set to nobody", async () => {
    const calls: unknown[] = [];
    const call = (async (cmd: string, args: unknown) => (calls.push([cmd, args]), ok)) as never;
    expect(await renameOnFirstPrompt("C:/w/a", "x", { renameBranches: false }, call, openPorts)).toBeNull();
    expect(await renameOnFirstPrompt("C:/w/b", "   \n ", {}, call, openPorts)).toBeNull();
    expect(calls).toEqual([]);
    await renameOnFirstPrompt("C:/w/c", "x", { commitWriter: "off" }, call, { ...openPorts, settings: async () => ({ commitWriter: "off" }) });
    expect(calls).toEqual([["workspace_rename_on_first_prompt", { path: "C:/w/c", task: "x", writer: null }]]);
  });

  test("row 931: with AI off for the whole app, this repository, or an unreadable settings file, the first prompt names the branch from its own words with no writer", async () => {
    const sent: unknown[] = [];
    const call = (async (_c: string, args: { writer: unknown }) => (sent.push(args.writer), ok)) as never;
    const gate = (settings: Record<string, unknown> | Error, repo: string | null): NamingPorts => ({
      settings: async () => {
        if (settings instanceof Error) throw settings;
        return settings;
      },
      repo: async () => repo,
    });
    await renameOnFirstPrompt("C:/w/g1", "x", {}, call, gate({ scmAiHidden: true }, "github.com/o/r"));
    await renameOnFirstPrompt("C:/w/g2", "x", {}, call, gate({ scmRepoAi: { "github.com/o/r": "off" } }, "github.com/o/r"));
    await renameOnFirstPrompt("C:/w/g3", "x", {}, call, gate(new Error("disk"), "github.com/o/r"));
    expect(sent).toEqual([null, null, null]);
    await renameOnFirstPrompt("C:/w/g4", "x", {}, call, gate({}, "github.com/o/r"));
    expect(sent[3]).toEqual({ agent: "claude", model: null, effort: null });
  });

  test("a failed rename keeps its complete output and lets a later prompt try again; success clears it (STAT-039)", async () => {
    let fail = true;
    const call = (async () => {
      if (fail) throw new Error("fatal: cannot lock ref 'refs/heads/tx/x': is at abc but expected def");
      return ok;
    }) as never;
    const heard: (string | null)[] = [];
    const off = onRename((e) => void (e.dir === "C:/w/err" && heard.push(e.error)));
    expect(await renameOnFirstPrompt("C:/w/err", "fix", {}, call, openPorts)).toBeNull();
    expect(heard[0]).toContain("cannot lock ref");
    fail = false;
    expect(await renameOnFirstPrompt("C:/w/err", "fix", {}, call, openPorts)).toEqual(ok);
    expect(heard).toHaveLength(2);
    expect(heard[1]).toBeNull();
    off();
  });

  test("a status report with a prompt points at the pane's folder; one without is ignored", () => {
    const cwdOf = (k: number) => (k === 4 ? "C:/w/four" : undefined);
    expect(promptTarget({ paneKey: 4, prompt: "  fix the build " }, cwdOf)).toEqual({ dir: "C:/w/four", prompt: "fix the build" });
    expect(promptTarget({ paneKey: 4 }, cwdOf)).toBeNull();
    expect(promptTarget({ paneKey: 9, prompt: "x" }, cwdOf)).toBeNull();
    expect(promptTarget({ prompt: "x" }, cwdOf)).toBeNull();
  });
});

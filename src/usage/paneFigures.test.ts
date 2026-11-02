import { afterEach, expect, test } from "vitest";
import { accountsToRead, readClaudeOf } from "./paneFigures";
import { publishClaudeActive, publishClaudeFor, publishCodexFor, readPlan } from "./plan";
import type { CodexUsage } from "./codex";

const ok: CodexUsage = { state: "ok", fiveHour: { usedPercent: 10, resetsAt: null, windowMins: 300 }, weekly: null, resetCredits: null, plan: null, message: null };
afterEach(() => (publishCodexFor("b", null), publishCodexFor(null, null)));

test("T-548-b: reads one account per distinct Codex pane account other than the active one, in pane order", () => {
  const panes = [
    { agent: "codex", account: "b" },
    { agent: "codex", account: "a" },
    { agent: "claude", account: "x" },
    { agent: "codex", account: "b" },
    { agent: "codex", account: null },
    { agent: "codex" },
    { agent: "shell", account: "z" },
  ];
  expect(accountsToRead(panes, "a")).toEqual(["b", null]);
  expect(accountsToRead(panes, null)).toEqual(["b", "a"]); // the system default is the active one
  expect(accountsToRead([{ agent: "codex", account: "a" }], "a")).toEqual([]);
  expect(accountsToRead([], "a")).toEqual([]);
});

test("T-548-b: figures are kept per account, replaced on a new read and dropped with null", () => {
  publishCodexFor("b", ok);
  publishCodexFor(null, { ...ok, plan: "plus" });
  expect(readPlan().codexBy?.b).toBe(ok);
  expect(readPlan().codexBy?.[""]?.plan).toBe("plus");
  const newer = { ...ok, fiveHour: { usedPercent: 50, resetsAt: null, windowMins: 300 } };
  publishCodexFor("b", newer);
  expect(readPlan().codexBy?.b).toBe(newer);
  publishCodexFor("b", null);
  expect(readPlan().codexBy?.b).toBeUndefined();
  expect(readPlan().codexBy?.[""]).toBeDefined();
});

// T-548-b: the Claude half. One reader per other Claude account a pane runs on, dropped when no pane needs it.
const limits = [{ kind: "five_hour", usedPercent: 41, resetsAt: null }, { kind: "seven_day", usedPercent: 12, resetsAt: null }];

test("T-548-b: reads one folder per distinct Claude pane account other than the active one; Codex panes ask for nothing", () => {
  const panes = [
    { agent: "claude", account: "b" },
    { agent: "claude", account: "a" },
    { agent: "codex", account: "x" },
    { agent: "claude", account: "b" },
    { agent: "claude", account: null },
    { agent: "claude" },
    { agent: "shell", account: "z" },
  ];
  expect(accountsToRead(panes, "a", "claude")).toEqual(["b", null]);
  expect(accountsToRead(panes, null, "claude")).toEqual(["b", "a"]);
  expect(accountsToRead([{ agent: "claude", account: "a" }], "a", "claude")).toEqual([]);
  expect(accountsToRead([{ agent: "codex", account: "b" }], "a", "claude")).toEqual([]);
  expect(accountsToRead(panes, "a")).toEqual(["x"]); // the Codex reader is unchanged
});

test("T-548-b: windows are kept per Claude account, replaced on a new read and dropped with null", () => {
  publishClaudeFor("b", limits);
  publishClaudeFor(null, [limits[0]]);
  expect(readPlan().claudeBy?.b).toBe(limits);
  expect(readPlan().claudeBy?.[""]).toEqual([limits[0]]);
  publishClaudeFor("b", [limits[1]]);
  expect(readPlan().claudeBy?.b).toEqual([limits[1]]);
  publishClaudeFor("b", null);
  expect(readPlan().claudeBy?.b).toBeUndefined();
  expect(readPlan().claudeBy?.[""]).toBeDefined();
  publishClaudeFor(null, null);
  publishClaudeActive("a");
  publishClaudeActive("a");
  expect(readPlan().claudeActive).toBe("a");
  publishClaudeActive(null);
  expect(readPlan().claudeActive).toBeNull();
});

test("T-548-b: an account's windows are read from its own config folder (claude_usage_of), the default sign-in from none", async () => {
  const calls: Array<[string, unknown]> = [];
  const call = async (command: string, args?: unknown) => {
    calls.push([command, args]);
    if (command === "claude_accounts") return { accounts: [{ id: "a", configDir: "C:/u/a" }, { id: "b", configDir: "C:/u/b" }] };
    return limits;
  };
  expect(await readClaudeOf("b", call)).toBe(limits);
  expect(calls).toEqual([["claude_accounts", undefined], ["claude_usage_of", { configDir: "C:/u/b" }]]);
  calls.length = 0;
  expect(await readClaudeOf(null, call)).toBe(limits);
  expect(calls).toEqual([["claude_usage_of", { configDir: null }]]);
  calls.length = 0;
  expect(await readClaudeOf("gone", call)).toEqual([]); // no longer listed: nothing to read
  expect(calls.map((c) => c[0])).toEqual(["claude_accounts"]);
});

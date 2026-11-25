import { expect, test } from "vitest";
import { allSwitchedOff, canLaunch, defaultAgentId, disabledAgents, FIRST_PASS, menuAgents, offeredAgents, switchAgent } from "./agents";
import type { AgentInfo } from "./PlusMenu";

const mk = (id: string, installed: boolean): AgentInfo => ({ id, name: id, program: id, args: [], installed, path: installed ? `C:\\bin\\${id}.exe` : null });
const list = [mk("claude", true), mk("opencode", false), mk("codex", true), mk("gemini", false), mk("grok", true)];

test("the menu lists only installed agents, the default first, the rest in catalogue order", () => {
  expect(menuAgents(list, "claude").map((a) => a.id)).toEqual(["claude", "codex", "grok"]);
  expect(menuAgents(list, "grok").map((a) => a.id)).toEqual(["grok", "claude", "codex"]);
  // A default that is not installed (or unknown) does not reorder anything.
  expect(menuAgents(list, "gemini").map((a) => a.id)).toEqual(["claude", "codex", "grok"]);
  expect(menuAgents(list, "nope").map((a) => a.id)).toEqual(["claude", "codex", "grok"]);
  expect(menuAgents([], "claude")).toEqual([]);
});

test("the default agent comes from settings; a fresh install has none (SESS-010)", () => {
  expect(defaultAgentId({ defaultAgent: "codex" })).toBe("codex");
  expect(defaultAgentId({ defaultAgent: "" })).toBe("");
  // SESS-010: a fresh install has no default.
  expect(defaultAgentId({ defaultAgent: 3 })).toBe("");
  expect(defaultAgentId({})).toBe("");
  expect(defaultAgentId(null)).toBe("");
});

test("switched-off agents are not offered, and switching off the default leaves no default", () => {
  const list = [{ id: "claude" }, { id: "codex" }, { id: "aider" }] as Parameters<typeof offeredAgents>[0];
  expect(offeredAgents(list, { disabledAgents: ["codex", 7] }).map((a) => a.id)).toEqual(["claude", "aider"]);
  expect(offeredAgents(list, {}).length).toBe(3);
  const off = switchAgent({ defaultAgent: "codex" }, "codex", false);
  expect(off).toEqual({ defaultAgent: "", disabledAgents: ["codex"] });
  expect(defaultAgentId(off)).toBe("");
  // switching another one off keeps the default; on again takes it out of the list
  expect(switchAgent({ defaultAgent: "codex" }, "aider", false)).toEqual({ defaultAgent: "codex", disabledAgents: ["aider"] });
  expect(switchAgent(off, "codex", true)).toEqual({ defaultAgent: "", disabledAgents: [] });
  expect(disabledAgents({ disabledAgents: "codex" })).toEqual([]);
});

test("SESS-003: all switched off is told apart from none installed; SESS-002: launching waits for a good search", () => {
  expect(allSwitchedOff(list, { disabledAgents: ["claude", "codex", "grok"] })).toBe(true);
  expect(allSwitchedOff(list, { disabledAgents: ["claude", "codex"] })).toBe(false);
  expect(allSwitchedOff(list.filter((a) => !a.installed), { disabledAgents: [] })).toBe(false);
  expect(canLaunch(FIRST_PASS)).toBe(false);
  expect(canLaunch({ looking: false, done: true, error: "boom" })).toBe(false);
  expect(canLaunch({ looking: true, done: true, error: null })).toBe(true);
});

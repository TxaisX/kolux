import { expect, test, vi } from "vitest";
import { canInstall, installTip, optionLabel, pickList, runInstall } from "./agentInstall";
import type { AgentInfo } from "./PlusMenu";

const a = (id: string, installed: boolean, more: Partial<AgentInfo> = {}): AgentInfo => ({ id, name: id.toUpperCase(), program: id, args: [], installed, path: null, ...more });

test("T-570 / T-664: every agent is listed A to Z by name, and nothing while detection runs", () => {
  const list = [a("aider", true), a("grok", false), a("codex", true), a("claude", true), a("goose", false)];
  expect(pickList(list, false).map((x) => x.id)).toEqual(["aider", "claude", "codex", "goose", "grok"]);
  // Case does not matter: a lower-case name sorts with the rest.
  expect(pickList([a("z", true, { name: "Zed" }), a("b", true, { name: "bob" }), a("a", true, { name: "Amp" })], false).map((x) => x.id)).toEqual(["a", "b", "z"]);
  expect(pickList(list, true)).toEqual([]);
});

test("T-570: a missing agent reads (not installed); an installed one is plain", () => {
  expect(optionLabel(a("grok", false))).toBe("GROK (not installed)");
  expect(optionLabel(a("claude", true))).toBe("CLAUDE");
});

test("T-570: Install is offered only for a missing agent with a route; the tooltip is the install command", () => {
  expect(canInstall(a("grok", false, { installable: true, install: "npm i -g grok" }))).toBe(true);
  expect(canInstall(a("grok", false))).toBe(true);
  expect(canInstall(a("grok", false, { installable: false }))).toBe(false);
  expect(canInstall(a("grok", true, { installable: true }))).toBe(false);
  expect(canInstall(undefined)).toBe(false);
  expect(installTip(a("grok", false, { install: "npm i -g grok" }))).toBe("npm i -g grok");
});

test("T-570: a finished install gives back the refreshed agent", async () => {
  const install = vi.fn(async (id: string) => a(id, true, { path: "C:/bin/grok.exe" }));
  expect(await runInstall(a("grok", false), install)).toEqual({ agent: a("grok", true, { path: "C:/bin/grok.exe" }) });
  expect(install).toHaveBeenCalledWith("grok");
});

test("T-570: the Err text shows as it is; an install that leaves the agent missing says so", async () => {
  expect(await runInstall(a("grok", false), async () => Promise.reject("Node.js could not be installed."))).toEqual({ error: "Node.js could not be installed." });
  expect(await runInstall(a("grok", false), async () => Promise.reject(new Error("boom")))).toEqual({ error: "boom" });
  expect(await runInstall(a("grok", false), async () => a("grok", false))).toEqual({ error: "GROK did not finish installing." });
});

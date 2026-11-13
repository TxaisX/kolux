// Claude Agent Teams in the picker: offered only with the mode on, Claude Code and the Kolux
// command line installed, and never on native Windows or WSL; the mode is off by default.
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { expect, test } from "vitest";
import type { AgentInfo } from "./PlusMenu";
import { effectiveMode, teamsEntry, teamsMode, withTeams, type TeamsHost } from "./teams";
import TeamsModeCard from "./TeamsModeCard";
import { selectIn } from "../tasks/selectHtml";

const claude: AgentInfo = { id: "claude", name: "Claude Code", program: "claude", args: [], installed: true, path: "/usr/local/bin/claude" };
const codex: AgentInfo = { id: "codex", name: "Codex", program: "codex", args: [], installed: true, path: "/usr/local/bin/codex" };
const linux: TeamsHost = { windows: false, wsl: false, cli: "kolux" };

test("the mode is off by default and anything unknown reads as off", () => {
  expect(teamsMode({})).toBe("off");
  expect(teamsMode(null)).toBe("off");
  expect(teamsMode({ agentTeamsMode: "tmux" })).toBe("off");
  expect(teamsMode({ agentTeamsMode: "native" })).toBe("native");
  expect(teamsMode({ agentTeamsMode: "in-process" })).toBe("in-process");
});

test("default build: no Agent Teams entry in any list", () => {
  expect(withTeams([claude, codex], {}, linux)).toEqual([claude, codex]);
});

test("with the mode on, Linux with Claude Code and the command line installed offers it right after Claude Code", () => {
  const list = withTeams([claude, codex], { agentTeamsMode: "in-process" }, linux);
  expect(list.map((a) => a.id)).toEqual(["claude", "claude-agent-teams", "codex"]);
  expect(list[1]).toMatchObject({ name: "Claude Agent Teams", program: "kolux", args: ["claude-teams"], installed: true });
});

test("native Windows and WSL never offer it, nor a machine missing Claude Code or the command line", () => {
  const on = "native";
  expect(teamsEntry([claude], on, { ...linux, windows: true })).toBeNull();
  expect(teamsEntry([claude], on, { ...linux, wsl: true })).toBeNull();
  expect(teamsEntry([claude], on, { ...linux, cli: null })).toBeNull();
  expect(teamsEntry([{ ...claude, installed: false }, codex], on, linux)).toBeNull();
  expect(teamsEntry([codex], on, linux)).toBeNull();
  // host facts not in yet: nothing offered
  expect(teamsEntry([claude], on, null)).toBeNull();
  expect(teamsEntry([claude], on, linux)).not.toBeNull();
});

test("on Windows and WSL teammates always run in-process", () => {
  expect(effectiveMode("native", { windows: true, wsl: false })).toBe("in-process");
  expect(effectiveMode("native", { windows: false, wsl: true })).toBe("in-process");
  expect(effectiveMode("native", { windows: false, wsl: false })).toBe("native");
  expect(effectiveMode("off", { windows: true, wsl: false })).toBe("off");
});

test("the Settings card shows the three choices, the saved one picked, and the Windows note", () => {
  const html = renderToString(createElement(TeamsModeCard, { settings: { agentTeamsMode: "native" }, save: () => {}, host: { windows: true, wsl: false, cli: null } }));
  expect(html).toContain("Claude Agent Teams");
  expect(selectIn(html, "Agent Teams mode")).toEqual({ chosen: "Native panes", offered: ["Off", "In-process", "Native panes"] });
  expect(html).toContain("On Windows Agent Teams is not offered in the picker, and teammates always run in-process");
  expect(html).toContain("Native panes acts as In-process here");
  const fresh = renderToString(createElement(TeamsModeCard, { settings: {}, save: () => {}, host: linux }));
  expect(selectIn(fresh, "Agent Teams mode")?.chosen).toBe("Off");
  expect(fresh).not.toContain("On Windows");
});

test("the Agent Teams row draws the Claude mark", async () => {
  const { markFor } = await import("./PlusMenu");
  expect(markFor("claude-agent-teams")).toBe("claude");
});

// SESS-009 (T-143): the agent dropdown leads with Claude Code, Codex and Grok, folds the rest, and
// a search reaches every installed agent, ranked name > alias > initials > command name.
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { expect, test, vi } from "vitest";
// The plus menu is a src/ui Popover, drawn only on a real DOM; what it holds is read here through a stand-in.
vi.mock("../ui/Popover", async () => (await import("../tasks/popoverStandIn")).popoverModule);
import { agentRows, searchAgents, wantsTerminal } from "./agents";
import PlusMenu, { type AgentInfo } from "./PlusMenu";

const mk = (id: string, name: string, program = id, installed = true): AgentInfo => ({ id, name, program, args: [], installed, path: installed ? `C:\bin\${program}.exe` : null });
const all = [mk("claude", "Claude Code"), mk("codex", "Codex"), mk("trae", "Trae", "traecli"), mk("aider", "Aider"), mk("aug", "Auggie", "auggie"), mk("copilot", "GitHub Copilot"), mk("grok", "Grok"), mk("gemini", "Gemini CLI", "gemini", false)];
const ids = (a: AgentInfo[] | null) => a?.map((x) => x.id);

test("three featured agents lead and the other installed ones fold", () => {
  const r = agentRows(all, "claude");
  expect(ids(r.top)).toEqual(["claude", "codex", "grok"]);
  expect(ids(r.more)).toEqual(["trae", "aider", "aug", "copilot"]);
  // A default outside the three leads too; none of the three installed shows everything unfolded.
  expect(ids(agentRows(all, "aider").top)).toEqual(["aider", "claude", "codex", "grok"]);
  const none = agentRows(all.filter((a) => !["claude", "codex", "grok"].includes(a.id)), "claude");
  expect([ids(none.top), none.more]).toEqual([["trae", "aider", "aug", "copilot"], []]);
});

test("search ranks name, then alias, then initials, then command name, and skips a long string", () => {
  expect(ids(searchAgents(all, "aid"))).toEqual(["aider"]);
  expect(ids(searchAgents(all, "GROK"))).toEqual(["grok"]);
  // "co": Codex starts with it; Claude Code and GitHub Copilot have a word that does (catalogue order).
  expect(ids(searchAgents(all, "co"))).toEqual(["codex", "claude", "copilot"]);
  expect(ids(searchAgents(all, "aug"))).toEqual(["aug"]);
  expect(ids(searchAgents(all, "gc"))).toEqual(["copilot"]);
  expect(ids(searchAgents(all, "traecli"))).toEqual(["trae"]);
  expect(ids(searchAgents(all, "gemini")), "not installed is never offered").toEqual([]);
  expect(searchAgents(all, "a".repeat(41)), "too long: ignored").toBeNull();
  expect(searchAgents(all, "  "), "blank: no search").toBeNull();
  expect([wantsTerminal("shell"), wantsTerminal("Term"), wantsTerminal("blank"), wantsTerminal("aid")]).toEqual([true, true, true, false]);
});

test("the menu shows the three, a Show more toggle, a blank-terminal row and Manage agents", () => {
  const html = renderToString(createElement(PlusMenu, { agents: all, onPick: () => {}, onClose: () => {}, onTerminal: () => {}, onManage: () => {} }));
  expect(html).toContain('placeholder="Search agents"');
  for (const n of ["Claude Code", "Codex", "Grok"]) expect(html).toContain(`>${n}<`);
  for (const n of ["Aider", "Auggie", "Trae"]) expect(html).not.toContain(`>${n}<`);
  expect(html).toContain("Show more agents (4)");
  expect(html).toContain("Blank terminal");
  expect(html).toContain("Manage agents");
  expect(html.indexOf("Blank terminal")).toBeGreaterThan(html.indexOf("Show more agents"));
});

import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { expect, test } from "vitest";
import { hooksDefault } from "../onboarding/hooksOn";
import { AgentsPageView, HooksSwitch, hookProblems, hooksOn } from "./AgentsPage";

test("the Agents page carries the 200k cap switch, on by default (USAGE-006)", () => {
  const html = renderToString(createElement(AgentsPageView, { cap: true, onCap: () => {} }));
  expect(html).toContain('role="switch"');
  expect(html).toContain('checked=""');
  expect(html).toContain("200k");
  expect(renderToString(createElement(AgentsPageView, { cap: false, onCap: () => {} }))).not.toContain('checked=""');
});

test("the status hooks switch installs only on a saved true, says what off does and names the file (STAT-002, T-152-gate)", () => {
  expect(hooksOn({})).toBe(false);
  expect(hooksOn({ agentStatusHooks: "x" })).toBe(false);
  expect(hooksOn({ agentStatusHooks: false })).toBe(false);
  expect(hooksOn({ agentStatusHooks: true })).toBe(true);
  expect(renderToString(createElement(HooksSwitch, { on: false, onSwitch: () => {}, file: "G:/scratch/claude/settings.json" }))).toContain("G:/scratch/claude/settings.json");
  const html = renderToString(createElement(HooksSwitch, { on: true, onSwitch: () => {} }));
  expect(html).toContain('role="switch"');
  expect(html).toContain('checked=""');
  expect(html).toContain("stops them being put back");
  expect(renderToString(createElement(HooksSwitch, { on: false, onSwitch: () => {} }))).not.toContain('checked=""');
});

// DT-C52 (PR #55 review): the switch starts on once the consent line was answered, and the guide says so; the text
// under the switch must not keep the pre-DT-C52 "Off until you turn it on".
test("the text under the status hooks switch says it starts on after the consent line, not off until turned on (DT-C52)", () => {
  expect(hooksDefault({})).toBe(true);
  const html = renderToString(createElement(HooksSwitch, { on: true, onSwitch: () => {} }));
  expect(html).not.toMatch(/Off until you turn it on/);
  expect(html).toContain("On once you have answered the line in setup");
});

test("a failed hook install or removal is shown beside the switch instead of being dropped (T-152-c (3))", () => {
  // The reply shape of agent_hooks_sync: one {agent, done, error} per agent.
  expect(hookProblems([{ agent: "claude", done: null, error: "settings.json changed twice while installing; switch off and on again" }, { agent: "codex", done: "removed", error: null }]))
    .toEqual(["claude: settings.json changed twice while installing; switch off and on again"]);
  expect(hookProblems([])).toEqual([]);
  expect(hookProblems(undefined)).toEqual([]);
  expect(hookProblems("not a list")).toEqual([]);
  const html = renderToString(createElement(HooksSwitch, { on: true, onSwitch: () => {}, problems: ["claude: install refused"] }));
  expect(html).toContain("claude: install refused");
  expect(html).toContain('role="alert"');
  expect(renderToString(createElement(HooksSwitch, { on: true, onSwitch: () => {} }))).not.toContain('role="alert"');
});

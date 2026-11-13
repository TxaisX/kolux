// TERM-122: keep-awake is Off by default, an older plain on reads as Agent, and the status bar
// item shows only while the computer is being kept awake.
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { expect, test } from "vitest";
import KeepAwakeCard, { awakeMode, KeepAwakeItem } from "./KeepAwakeCard";
import { selectIn } from "../tasks/selectHtml";

test("off by default; an older plain on reads as Agent; anything unknown is off", () => {
  expect(awakeMode({})).toBe("off");
  expect(awakeMode(null)).toBe("off");
  expect(awakeMode({ keepAwake: true })).toBe("agent");
  expect(awakeMode({ keepAwake: false })).toBe("off");
  expect(awakeMode({ keepAwake: "on" })).toBe("on");
  expect(awakeMode({ keepAwake: "nope" })).toBe("off");
});

test("the Settings card offers On, Agent and Off, picks the saved one and explains the lid", () => {
  const fresh = renderToString(createElement(KeepAwakeCard, { settings: {}, save: () => {} }));
  expect(selectIn(fresh, "Keep the computer awake")).toEqual({ chosen: "Off", offered: ["Off", "Agent", "On"] });
  expect(fresh).toContain("Closing the lid still follows the system");
  const agent = renderToString(createElement(KeepAwakeCard, { settings: { keepAwake: true }, save: () => {} }));
  expect(selectIn(agent, "Keep the computer awake")?.chosen).toBe("Agent");
  expect(agent).toContain("while an agent is working");
  // an agent typed into a shell pane ends with the shell, not with the agent: say how long it can count
  expect(agent).toContain("at most 30 minutes after its last word");
  // Microsoft's pages disagree on Modern Standby (System Sleep Criteria: drains even with the lid
  // closed; PowerSetRequest remarks: lid close ends the request, and on battery it ends a few
  // minutes after the sleep timeout), so the help says "can" and names both outcomes
  const on = renderToString(createElement(KeepAwakeCard, { settings: { keepAwake: "on" }, save: () => {} }));
  expect(on).toContain("can drain the battery");
  expect(on).not.toContain("drains the battery even with the lid closed");
  expect(on).toContain("closing the lid may still put it to sleep");
  expect(on).toContain("a few minutes after its usual sleep timeout");
});

const HOOKS_OFF = "Agent mode follows the agent status hooks, which are off: turn them on above, or pick On.";

test("Agent mode with the status hooks off (their default) says it cannot hold, and points to the hooks or On", () => {
  // hooks unset is off (Settings > Agents reads only a saved true as on)
  const unset = renderToString(createElement(KeepAwakeCard, { settings: { keepAwake: "agent" }, save: () => {} }));
  expect(unset).toContain(HOOKS_OFF);
  const off = renderToString(createElement(KeepAwakeCard, { settings: { keepAwake: "agent", agentStatusHooks: false }, save: () => {} }));
  expect(off).toContain(HOOKS_OFF);
  // hooks on: Agent mode works, no warning
  const on = renderToString(createElement(KeepAwakeCard, { settings: { keepAwake: "agent", agentStatusHooks: true }, save: () => {} }));
  expect(on).not.toContain(HOOKS_OFF);
  // the warning is about Agent mode only: Off and On do not depend on the hooks
  for (const keepAwake of ["off", "on"]) {
    expect(renderToString(createElement(KeepAwakeCard, { settings: { keepAwake }, save: () => {} }))).not.toContain(HOOKS_OFF);
  }
});

test("the status bar item shows only while the computer is kept awake", () => {
  const shown = renderToString(createElement(KeepAwakeItem, { held: true }));
  expect(shown).toContain("Awake");
  // the bar styles its items by the `item` class; an unstyled class would draw it bare
  expect(shown).toMatch(/^<span class="item" data-item="keep-awake"/);
  expect(renderToString(createElement(KeepAwakeItem, { held: false }))).toBe("");
});

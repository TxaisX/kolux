// T-809 (P4a-11, P4a-12): the Agents rail says where the plain shells are, an ended pane reads "Ended" not
// "Starting…", and the New session picker starts on the default agent with the installed ones above the rest.
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { expect, test } from "vitest";
import { startingLine } from "../chat/model";
import AgentsRail from "./AgentsRail";
import ChooserPane from "../launch/ChooserPane";
import { firstSeatStart } from "../launch/defaultSeat";
import type { AgentInfo } from "../launch/PlusMenu";
import { emptySeat, TERMINAL, type Seat } from "../launch/seats";
import { railGroups, rowStatus, shellNote } from "./rail";

const shell = (key: number) => ({ key, program: null, cwd: "C:/w/app" });
const ai = (key: number) => ({ key, agentId: "claude", program: "claude", cwd: "C:/w/app" });

test("P4a-12: the rail names the shells it does not list, singular and plural, and says nothing without any", () => {
  expect(shellNote([ai(1)])).toBe("");
  expect(shellNote([ai(1), shell(2)])).toBe("1 shell is on the Terminals screen");
  expect(shellNote([shell(1), shell(2), shell(3), ai(4)])).toBe("3 shells are on the Terminals screen");
  // Editor and browser tabs and not-started presets are not shells.
  expect(shellNote([{ key: 1, program: null, cwd: null, kind: "editor" }, { key: 2, program: null, cwd: null, seats: [{ agent: null }] }])).toBe("");
});

test("P4a-12: the rail shows that line as a button to the Terminals screen, and no button without shells", () => {
  const base = { groups: railGroups([ai(1)], [{ id: "claude", name: "Claude Code" }]) as never, selected: 1, classic: false, statusOf: ((p: never) => rowStatus(p, null)) as never, ringOf: () => null, footer: "", onSelect: () => {}, onAdd: () => {}, onSettings: () => {} };
  const withShells = renderToStaticMarkup(createElement(AgentsRail as never, { ...base, shells: shellNote([ai(1), shell(2), shell(3)]), onTerminals: () => {} }));
  expect(withShells).toContain("data-rail-shells");
  expect(withShells).toContain("2 shells are on the Terminals screen");
  expect(renderToStaticMarkup(createElement(AgentsRail as never, { ...base, shells: "" }))).not.toContain("data-rail-shells");
});

test("P4a-12: the line over a pane the screen is waiting on says Ended once the process is gone", () => {
  expect(startingLine(false)).toBe("Starting…");
  expect(startingLine(true)).toBe("Ended");
});

// ---- the seat picker (P4a-11) ----

const info = (id: string, name: string, installed: boolean): AgentInfo => ({ id, name, program: id, args: [], installed, path: null });
const AGENTS = [info("aider", "Aider", false), info("grok", "Grok", true), info("claude", "Claude Code", true), info("zed", "Zed", false)];
const D = { model: "opus", effort: "high" };

test("P4a-11: the picker puts Installed above Others, each A to Z, with Terminal after both", () => {
  const html = renderToStaticMarkup(createElement(ChooserPane, { number: 1, agents: AGENTS, seats: [emptySeat()], onSeats: () => {}, onLineup: () => {}, shape: "custom", task: "", onTask: () => {}, onStart: () => {}, copies: "shared", inGit: true, onCopies: () => {}, closable: true, onClose: () => {}, saved: [], onSaved: () => {}, onPickSaved: () => {} }));
  const at = (s: string) => html.indexOf(s);
  expect(at('label="Installed"')).toBeGreaterThan(-1);
  expect(at('label="Installed"')).toBeLessThan(at("Claude Code"));
  expect(at("Claude Code")).toBeLessThan(at("Grok"));
  expect(at("Grok")).toBeLessThan(at('label="Others"'));
  expect(at('label="Others"')).toBeLessThan(at("Aider (not installed)"));
  expect(at("Aider (not installed)")).toBeLessThan(at("Zed (not installed)"));
  expect(at("Zed (not installed)")).toBeLessThan(at(">Terminal<"));
});

test("P4a-11: seat 1 starts on the default agent when it is installed and every seat is blank; otherwise nothing changes", () => {
  const blank: Seat[] = [emptySeat(), emptySeat()];
  const out = firstSeatStart(blank, "claude", AGENTS, D)!;
  expect(out[0]).toMatchObject({ agent: "claude", model: "opus" });
  expect(out[1]).toEqual(emptySeat());
  expect(firstSeatStart(blank, "", AGENTS, D), "no default saved").toBeNull();
  expect(firstSeatStart(blank, "aider", AGENTS, D), "a default that is not installed").toBeNull();
  expect(firstSeatStart(blank, "gone", AGENTS, D), "a default that is not offered").toBeNull();
  expect(firstSeatStart([{ agent: TERMINAL, model: null }, emptySeat()], "claude", AGENTS, D), "a seat already has a pick").toBeNull();
});

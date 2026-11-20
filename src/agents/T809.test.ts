// T-809 (P4a-11, P4a-12): an ended pane reads "Ended" not "Starting…", and the Start agents picker starts on the default agent with the installed ones above the rest.
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { expect, test } from "vitest";
import { startingLine } from "../chat/model";
import ChooserPane from "../launch/ChooserPane";
import { firstSeatStart } from "../launch/defaultSeat";
import type { AgentInfo } from "../launch/PlusMenu";
import { emptySeat, TERMINAL, type Seat } from "../launch/seats";

test("P4a-12: the line over a pane the screen is waiting on says Ended once the process is gone", () => {
  expect(startingLine(false)).toBe("Starting…");
  expect(startingLine(true)).toBe("Ended");
});

// ---- the seat picker (P4a-11) ----

const info = (id: string, name: string, installed: boolean): AgentInfo => ({ id, name, program: id, args: [], installed, path: null });
const AGENTS = [info("aider", "Aider", false), info("grok", "Grok", true), info("claude", "Claude Code", true), info("zed", "Zed", false)];
const D = { model: "opus", effort: "high" };

// Txais 2026-11-08 (a92dae95) replaced the Installed/Others dropdown with a button row: the featured agents in
// FEATURED order, then Terminal, then Other… (installed agents without a button of their own).
test("P4a-11: the picker shows the featured agents first, then Terminal, then Other…; unfeatured missing agents get no button", () => {
  const html = renderToStaticMarkup(createElement(ChooserPane, { number: 1, agents: AGENTS, seats: [emptySeat()], onSeats: () => {}, onLineup: () => {}, shape: "custom", task: "", onTask: () => {}, onStart: () => {}, copies: "shared", inGit: true, onCopies: () => {}, closable: true, onClose: () => {}, saved: [], onSaved: () => {}, onPickSaved: () => {} }));
  const at = (s: string) => html.indexOf(s);
  expect(at("Claude Code")).toBeGreaterThan(-1);
  expect(at("Claude Code")).toBeLessThan(at("Grok"));
  expect(at("Grok")).toBeLessThan(at(">Terminal<"));
  expect(at(">Terminal<")).toBeLessThan(at("Other…"));
  expect(html).not.toContain("Aider");
  expect(html).not.toContain("Zed");
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

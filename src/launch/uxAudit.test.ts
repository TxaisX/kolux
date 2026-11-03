// UX audit lane E2: the small behaviour changes on the launch and agents screens.
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { expect, test } from "vitest";
import AgentsRail from "../agents/AgentsRail";
import ChooserPane, { holdsTyping, selfInstallHint, sheetKey } from "./ChooserPane";
import PlusMenu, { type AgentInfo } from "./PlusMenu";
import { DISMISS_FAILED, dismissFailedNotice, ToolNoticesView } from "./ToolNotices";
import { canInstall as installRule } from "./agentInstall";
import { failureNote } from "./launchOrder";
import { canInstall as checklistRule } from "./pickerRules";
import { ASK_ABOVE, countPlan, MAX_SESSIONS, resizeSeats, restoreTeam, sheetStart, shownPick, emptySeat, tooManySeats, type SavedShape, type Seat } from "./seats";
import { pickableModes } from "./teams";
import { CHECK_FAILED, toolNotices, type Tools } from "./toolChecks";

const agent = (id: string, o: Partial<AgentInfo> = {}): AgentInfo => ({ id, name: id.toUpperCase(), program: id, args: [], installed: false, path: null, ...o });
const claude = agent("claude", { installed: true, path: "C:/claude.exe" });

test("F7: a typed session count is capped, and asked about above 8 only when it grows the lineup", () => {
  expect(countPlan(500, 1)).toEqual({ n: MAX_SESSIONS, ask: true });
  expect(countPlan(ASK_ABOVE, 1)).toEqual({ n: 8, ask: false });
  expect(countPlan(ASK_ABOVE + 1, 1).ask).toBe(true);
  expect(countPlan(12, 20).ask).toBe(false); // shrinking never asks
  expect(resizeSeats([emptySeat()], 500)).toHaveLength(MAX_SESSIONS);
});

test("F7: the count field is capped in the page and a pending big count shows nothing until typed", () => {
  const html = renderToString(createElement(ChooserPane, { number: 1, agents: [claude], seats: [emptySeat()], onSeats() {}, shape: "custom", onLineup() {}, task: "", onTask() {}, onStart() {}, copies: "shared", inGit: true, onCopies() {}, closable: true, onClose() {}, saved: [], onSaved() {}, onPickSaved() {} }));
  expect(html).toContain(`max="${MAX_SESSIONS}"`);
  expect(html).not.toContain("is a lot");
});

test("F7: a failed Start says how many workspaces it already made and that they are in the sidebar", () => {
  expect(failureNote("Error: boom", 0)).toBe("Error: boom");
  expect(failureNote("Error: boom", 2)).toContain("2 new workspaces were already made; they are in the sidebar.");
  expect(failureNote("Error: boom", 1)).toContain("1 new workspace was already made; it is in the sidebar.");
});

test("F7: a launch past MAX_SESSIONS seats is refused, and a remembered lineup is clamped to it", () => {
  expect(tooManySeats(MAX_SESSIONS)).toBeNull();
  expect(tooManySeats(MAX_SESSIONS + 1)).toContain(`at most ${MAX_SESSIONS}`);
  const big = { shape: "custom" as const, copies: "shared" as const, seats: Array.from({ length: 500 }, () => emptySeat()) };
  expect(sheetStart(big as never, true).seats).toHaveLength(MAX_SESSIONS);
});

test("F1: Esc is ignored while Starting, and a box holding typing is left before the page closes", () => {
  const key = { key: "Escape", ctrlKey: false, metaKey: false };
  expect(sheetKey(key, [], false)).toBe("close");
  expect(sheetKey(key, [], false, true)).toBeNull();
  expect(holdsTyping({ tagName: "TEXTAREA", value: "fix the bug" })).toBe(true);
  expect(holdsTyping({ tagName: "TEXTAREA", value: "  " })).toBe(false);
  expect(holdsTyping({ tagName: "INPUT", type: "text", value: "a" })).toBe(true);
  expect(holdsTyping({ tagName: "INPUT", type: "number", value: "3" })).toBe(false);
  expect(holdsTyping({ tagName: "BUTTON" })).toBe(false);
});

test("F1: the sheet's X and Cancel are disabled while Starting", () => {
  const props = { number: 1, agents: [claude], seats: [{ agent: "terminal", model: null }] as Seat[], onSeats() {}, shape: "custom" as const, onLineup() {}, task: "", onTask() {}, onStart() {}, copies: "shared" as const, inGit: true, onCopies() {}, closable: true, onClose() {}, saved: [], onSaved() {}, onPickSaved() {}, sheet: { project: "P", path: "/p" } };
  const idle = renderToString(createElement(ChooserPane, props));
  const busy = renderToString(createElement(ChooserPane, { ...props, busy: true }));
  const close = (h: string) => h.split("<button").find((b) => b.includes('aria-label="Close New session"'))!;
  const cancel = (h: string) => h.split("<button").find((b) => b.includes(">Cancel<"))!;
  expect(close(idle)).not.toContain("disabled");
  expect(cancel(idle)).not.toContain("disabled");
  expect(close(busy)).toContain("disabled");
  expect(cancel(busy)).toContain("disabled");
});

test("F3: a seat shows its not-yet-startable pick only while the seat is still empty", () => {
  const seats: Seat[] = [emptySeat(), { agent: "codex", model: null }];
  expect(shownPick(seats, { 0: "grok", 1: "grok" }, 0)).toBe("grok");
  expect(shownPick(seats, { 0: "grok", 1: "grok" }, 1)).toBe("codex"); // a stale pick no longer wins
  expect(shownPick(seats, {}, 0)).toBeNull();
});

test("F4: undo puts back only the deleted team at its old place, keeping newer edits", () => {
  const t = (name: string): SavedShape => ({ name, seats: [], copies: "shared" });
  const newer = [t("A"), t("C"), t("New")]; // B was deleted, then New was saved
  expect(restoreTeam(newer, t("B"), 1).map((x) => x.name)).toEqual(["A", "B", "C", "New"]);
  expect(restoreTeam(newer, t("B"), 99).map((x) => x.name)).toEqual(["A", "C", "New", "B"]);
  const taken = restoreTeam(newer, t("A"), 0); // a same-named team already exists: it comes back under a free name
  expect(taken.map((x) => x.name)).toEqual(["A 2", "A", "C", "New"]);
});

test("F4: a missing agent with no install route and no docs page says to install it by hand", () => {
  expect(selfInstallHint(agent("ante", { installable: false }))).toContain("Install it yourself, then press Refresh agents");
  expect(selfInstallHint(agent("ante", { installable: false, docs: true }))).toBeNull();
  expect(selfInstallHint(agent("ante", { installable: true }))).toBeNull();
  expect(selfInstallHint(claude)).toBeNull();
});

test("F5: the chooser's Install and the checklist use one canInstall rule", () => {
  for (const a of [agent("x"), agent("x", { installable: true }), agent("x", { installable: false }), agent("x", { installable: true, installed: true }), agent("x", { installed: true })]) {
    expect(checklistRule(a)).toBe(installRule(a));
  }
});

test("F4: Native panes is offered in Agent Teams only to a profile that already has it", () => {
  expect(pickableModes("off")).toEqual(["off", "in-process"]);
  expect(pickableModes("in-process")).toEqual(["off", "in-process"]);
  expect(pickableModes("native")).toEqual(["off", "in-process", "native"]);
});

const tools: Tools = { git: "ok", gh: "ok", ghSignedIn: "ok", glab: "ok", githubProjects: [], gitlabProjects: [], dismissed: {} };
const view = (notices: ReturnType<typeof toolNotices>) => renderToString(createElement(ToolNoticesView, { notices, busy: false, onDismiss() {}, onRefresh() {} }));

test("F2: the no-AI-program notice has an Open Settings button; a failed check says so with Try again", () => {
  const noAi = view(toolNotices(tools, false));
  expect(noAi).toContain("Open Settings");
  expect(view(toolNotices({ ...tools, git: "missing" }, true))).not.toContain("Open Settings");
  const failed = view([CHECK_FAILED]);
  expect(failed).toContain("could not check which tools");
  expect(failed).toContain(">Try again<");
});

test("F2: a dismissal that could not be saved shows its own notice, with Dismiss only", () => {
  const html = view([dismissFailedNotice("disk full")]);
  expect(html).toContain("Kolux could not save that dismissal: disk full");
  expect(html).toContain(`data-notice="${DISMISS_FAILED}"`);
  expect(html).toContain(">Dismiss<");
  expect(html).not.toContain("Check again");
});

test("F6: each notice's buttons name their notice for a screen reader", () => {
  const html = view(toolNotices({ ...tools, git: "missing" }, false));
  expect(html).toContain('aria-label="Check again: Git is not installed, so projects cannot be added or opened"');
  expect(html).toContain('aria-label="Dismiss: No AI program found on this computer"');
});

test("F1: the plus menu's extra buttons are menu items", () => {
  const html = renderToString(createElement(PlusMenu, { agents: [claude, agent("codex", { installed: true, path: "/c" })], defaultId: "claude", onPick() {}, onSetDefault() {}, onClose() {} }));
  expect(html).toContain('role="menuitem" class="menu-default"');
});

test("F4/F6: the Agents rail marks the picked session, and its empty text covers 'nothing installed'", () => {
  const props = { classic: false, statusOf: (() => ({ word: "Idle", explain: "", line: "", tone: "" })) as never, ringOf: () => null, footer: "", onSelect() {}, onAdd() {}, onSettings() {} } as const;
  const none = renderToString(createElement(AgentsRail, { ...props, groups: [], selected: null }));
  expect(none).toContain("Install one or switch one on in Settings");
  const groups = [{ id: "claude", name: "Claude", sessions: [{ key: 1, agentId: "claude", program: "claude", cwd: null }, { key: 2, agentId: "claude", program: "claude", cwd: null }] }];
  const html = renderToString(createElement(AgentsRail, { ...props, groups, selected: 2 }));
  expect(html.match(/aria-current="true"/g)).toHaveLength(1);
  expect(html.split("<div").find((d) => d.includes('data-session="2"'))).toContain('aria-current="true"');
});

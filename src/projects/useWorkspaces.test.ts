// T-614 (F04-projects-scm.2): removing workspaces closes only their tabs, built on the tabs as they
// are when the delete finishes. The real useWorkspaceActions in a small host on the small DOM; the
// actions are taken from the render in which the delete was clicked, as the sidebar's async delete
// holds them while git works (seconds on Windows).
import { act, createElement, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { beforeEach, expect, test } from "vitest";
import type { Pane } from "../App";
import { type FakeDocument, installDom, mount } from "../tasks/fakeDom";
import { useWorkspaceActions } from "./useWorkspaces";

const A = "C:/w/ws/a";
const B = "C:/w/ws/b";
const C = "C:/w/ws/c";
const pane = (key: number, cwd: string): Pane => ({ key, cwd, branch: null, agent: "shell", program: null, args: [] });

type Host = { actions: ReturnType<typeof useWorkspaceActions>; panes: Pane[]; setPanes: Dispatch<SetStateAction<Pane[]>>; active: string | null; focused: number };
let host: Host;
let doc: FakeDocument;

function Harness({ start, active, recent }: { start: Pane[]; active: string; recent: string[] }) {
  const [panes, setPanes] = useState(start);
  const [focused, setFocused] = useState(start[0].key);
  const [activeDir, setActiveDir] = useState<string | null>(active);
  const [, setStacked] = useState<Record<string, boolean>>({});
  const nextKey = useRef(100);
  const recentDirs = useRef(recent);
  const activeRef = useRef<string | null>(activeDir);
  activeRef.current = activeDir;
  const owner = { [A]: "p1", [B]: "p1", [C]: "p1" };
  const actions = useWorkspaceActions({ panes, setPanes, setFocused, setActiveDir, setStacked, nextKey, settings: {}, screen: "terminals", setScreen: () => {}, setPage: () => {}, owner, recentDirs, activeRef });
  host = { actions, panes, setPanes, active: activeDir, focused };
  return null;
}

beforeEach(() => {
  doc = installDom().doc;
});

const keys = () => host.panes.map((p) => p.key);

test("two workspaces removed in turn with a tab opened in between: the new tab stays, the removed ones never come back", async () => {
  await mount(createElement(Harness, { start: [pane(1, A), pane(2, B), pane(3, C)], active: B, recent: [B, A, C] }), doc);
  const clicked = host.actions; // the sidebar's delete keeps the actions of the render it was clicked in
  await act(async () => clicked.removed(A));
  expect(keys()).toEqual([2, 3]);
  await act(async () => host.setPanes((ps) => [...ps, pane(4, B)])); // an agent tab opened while the next delete ran
  await act(async () => clicked.removed(C));
  expect(keys(), "tab 4 survives, tabs 1 and 3 stay closed").toEqual([2, 4]);
  expect(host.active).toBe(B);
});

test("removing several at once is one call: the shown workspace gives way to a sibling that is not going too", async () => {
  await mount(createElement(Harness, { start: [pane(1, A), pane(2, B), pane(3, C)], active: A, recent: [A, B, C] }), doc);
  const clicked = host.actions;
  await act(async () => host.setPanes((ps) => [...ps, pane(5, C)]));
  await act(async () => clicked.removedAll([A, B]));
  expect(keys()).toEqual([3, 5]);
  expect(host.active, "B was used more recently but is going too").toBe(C);
  expect([3, 5]).toContain(host.focused);
});

test("T-664 (b): selecting a new workspace with a prefill opens its chooser with Seat 1 and the task filled, and starts nothing", async () => {
  const D = "C:/w/ws/d";
  await mount(createElement(Harness, { start: [pane(1, A)], active: A, recent: [A] }), doc);
  await act(async () => host.actions.select(D, "d-branch", true, { agent: "claude", task: "write the tests" }));
  const made = host.panes.filter((p) => p.cwd === D);
  expect(made.length).toBeGreaterThan(0);
  expect(made[0].seats).toEqual([{ agent: "claude", model: null }]);
  expect(made[0].task).toBe("write the tests");
  expect(made.every((p) => p.program === null), "no program: nothing is running").toBe(true);
  expect(host.active).toBe(D);
});

test("T-664 (b): a prefill never changes a workspace that already has panes", async () => {
  await mount(createElement(Harness, { start: [pane(1, A), pane(2, B)], active: A, recent: [A, B] }), doc);
  await act(async () => host.actions.select(B, null, false, { agent: "claude", task: "ignored" }));
  expect(host.panes).toEqual([pane(1, A), pane(2, B)]);
  expect(host.active).toBe(B);
});

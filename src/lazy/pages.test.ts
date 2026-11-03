// T-706 / DT-C142 (shell.md row 6, the loading half): the first open of a full-page screen shows a quiet
// "Loading…" status while its code is read, instead of a blank window. Pane bodies, sheets and dialogs
// still draw nothing while they load, so a pane's tab and divider do not flash a placeholder.
import { createElement, type ComponentType } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { find, installDom, mount, settle, until, type FakeDocument, type FakeNode } from "../tasks/fakeDom";

// A screen and a pane body whose code never arrives: what shows is only ever the fallback.
vi.mock("../tasks/TasksPage", () => new Promise(() => {}));
vi.mock("../editor/Explorer", () => new Promise(() => {}));

let doc: FakeDocument;
let unmount: () => Promise<void> = async () => {};
beforeEach(() => {
  doc = installDom().doc;
});
afterEach(async () => {
  await unmount();
  unmount = async () => {};
});

const status = (root: FakeNode) => find(root, (n) => n.attrs.role === "status");

async function draw(el: Parameters<typeof mount>[0]) {
  const m = await mount(el, doc);
  unmount = m.unmount;
  return m.container;
}

test("a full-page screen whose code is still loading shows a quiet Loading… status", async () => {
  const { TasksPage } = await import("./pages");
  const c = await draw(createElement(TasksPage, { repo: null, onStart: () => {}, onResume: () => {} } as never));
  await settle();
  const s = status(c);
  expect(s).toHaveLength(1);
  expect(s[0].textContent).toBe("Loading…");
  expect(s[0].attrs.class).toBe("empty"); // the muted, centred empty-state style, no new CSS
});

test("a pane body whose code is still loading draws nothing", async () => {
  const { Explorer } = await import("./pages");
  const c = await draw(createElement(Explorer, {} as never));
  await settle();
  expect(c.childNodes).toHaveLength(0);
  expect(c.textContent).toBe("");
});

test("the fallback gives way to the screen once its code arrives", async () => {
  const { deferred } = await import("./deferred");
  let arrive!: (m: { default: ComponentType<object> }) => void;
  const Screen = deferred(() => new Promise<{ default: ComponentType<object> }>((r) => (arrive = r)), createElement("div", { role: "status" }, "Loading…"));
  const c = await draw(createElement(Screen));
  await until(() => status(c).length === 1, "the fallback");
  arrive({ default: () => createElement("main", null, "Tasks") });
  await until(() => c.textContent === "Tasks", "the screen");
  expect(status(c)).toHaveLength(0);
});

test("only the full-page screens Content.tsx draws carry the fallback", () => {
  const fs = (globalThis as unknown as { process: { getBuiltinModule(name: string): { readFileSync(p: URL, enc: string): string } } }).process.getBuiltinModule("node:fs");
  const src = fs.readFileSync(new URL("./pages.tsx", import.meta.url), "utf8");
  const withFallback = [...src.matchAll(/export const (\w+) = deferred\b[^\n]*, loading\);/g)].map((m) => m[1]).sort();
  expect(withFallback).toEqual(["AgentsChat", "ArtifactsPage", "AutomationsPage", "FloorView", "InboxView", "RoutingPage", "SkillsPage", "SpaceView", "TasksPage", "TowerView"]);
});

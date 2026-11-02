// VIEW-051 acceptance: the real ProjectsPanel on the small DOM, fed the window's panes as the `sessions` prop.
// MIRROR src/App.tsx (the `sessions` prop built from the window's panes); the row and count decisions are ProjectsPanel's liveIn/liveCount (T-640: terminal rows are gone from the left pane; they stay tabs in the main area).
import { createElement } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { type FakeDocument, type FakeNode, find, installDom, mount, settle } from "../../tasks/fakeDom";

const h = vi.hoisted(() => ({ wt: [] as unknown[] }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string) => {
    if (cmd === "project_list") return Promise.resolve([{ id: "p1", name: "app", path: "C:/w/app" }]);
    if (cmd === "workspace_scan") return Promise.resolve({ list: h.wt, unseen: [] });
    if (cmd === "workspaces_place_get") return Promise.resolve({ dir: "", flat: false, used: [], fromEnv: false });
    if (cmd === "setup_suggestion") return Promise.resolve({ kind: "none" });
    if (cmd === "groups_get" || cmd === "activity_get" || cmd === "project_icons_list") return Promise.resolve({});
    return Promise.resolve(null);
  },
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: () => Promise.resolve(() => {}) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: () => Promise.resolve(null) }));

type Session = { key: number; agent: string; title: string; cwd: string | null; running: boolean };
const wt = { path: "C:/w/app", branch: "main", head: "abc1234", isMain: true, hidden: false, number: null, comment: "" };
let doc: FakeDocument;
let unmount: () => Promise<void> = async () => {};

beforeEach(() => {
  const dom = installDom();
  doc = dom.doc;
  Object.assign(dom.win, { setInterval, clearInterval, setTimeout, clearTimeout }); // the small DOM has no timers on window
  Object.assign(doc, { querySelectorAll: () => [], querySelector: () => null, visibilityState: "visible", hidden: false });
  h.wt = [wt];
});
afterEach(async () => {
  await unmount();
  unmount = async () => {};
});

async function panel(sessions: Session[]) {
  const { default: ProjectsPanel } = await import("../ProjectsPanel");
  const props = {
    openDirs: ["C:/w/app"], sessions, states: {}, unread: new Set<string>(), onUnread: () => {}, settings: {}, onSetting: () => {},
    activeDir: "C:/w/app", onSelect: () => {}, onRemoved: () => {}, onSleep: () => {}, agents: [], launching: false, onLaunch: () => {},
    defaultId: "claude", onSetDefault: () => {}, onChoose: () => {}, page: null, onPage: () => {}, refresh: 0, onIndex: () => {},
    createRequest: 0, deleteRequest: 0, onStartIn: () => {}, nest: true, onNest: () => {}, artifactsOn: false, onArtifacts: () => {},
  };
  const m = await mount(createElement(ProjectsPanel, props as never), doc);
  unmount = m.unmount;
  await settle(120);
  return m.container as FakeNode;
}
const paneRows = (c: FakeNode) => find(c, (n) => n.attrs["data-pane"] !== undefined);
const counts = (c: FakeNode) => find(c, (n) => String(n.attrs.className ?? n.attrs.class ?? "").split(" ").includes("count")).map((n) => n.textContent.trim());

test("box 1: running Cursor and Gemini panes are counted but not listed as rows in the left pane", async () => {
  const c = await panel([
    { key: 1, agent: "cursor", title: "Fix the login", cwd: "C:/w/app", running: true },
    { key: 2, agent: "gemini", title: "Write the docs", cwd: "C:/w/app", running: true },
  ]);
  expect(paneRows(c)).toEqual([]);
  expect(counts(c)).toEqual(["2"]);
});

test("box 2: closing a tab (its pane stops running) drops the worktree's count, and none shows no count", async () => {
  const two: Session[] = [
    { key: 1, agent: "claude", title: "a", cwd: "C:/w/app", running: true },
    { key: 2, agent: "codex", title: "b", cwd: "C:/w/app", running: true },
  ];
  const before = await panel(two);
  expect(counts(before)).toEqual(["2"]);
  await unmount();
  const after = await panel([two[0], { ...two[1], running: false }]);
  expect(counts(after)).toEqual(["1"]);
  await unmount();
  const none = await panel([{ ...two[0], running: false }, { ...two[1], running: false }]);
  expect(paneRows(none)).toEqual([]);
  expect(counts(none)).toEqual([]);
});

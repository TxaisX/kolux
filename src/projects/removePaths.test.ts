// T-640: every row in the left pane can be removed or hidden from a right-click menu and a hover X.
// The real ProjectsPanel on the small DOM, with the backend mocked.
import { createElement } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { type FakeDocument, type FakeNode, byLabel, byText, click, find, fire, installDom, mount, settle } from "../tasks/fakeDom";

const h = vi.hoisted(() => ({ calls: [] as string[], settings: {} as Record<string, unknown> }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string) => {
    h.calls.push(cmd);
    if (cmd === "get_settings") return Promise.resolve(h.settings);
    if (cmd === "workspace_remove_check") return Promise.resolve({ changes: [], locked: null, nested: [], stamp: "s", commits: [] });
    if (cmd === "project_remove") return Promise.resolve({ name: "app", path: "C:/w/app", ended: 0 });
    if (cmd === "workspace_statuses") return Promise.resolve({ list: [] });
    if (cmd === "visibility_get") return Promise.resolve([]);
    if (cmd === "project_list") return Promise.resolve([{ id: "p1", name: "app", path: "C:/w/app" }]);
    if (cmd === "workspace_scan") return Promise.resolve({ list: [main, ws], unseen: [] });
    if (cmd === "workspaces_place_get") return Promise.resolve({ dir: "", flat: false, used: [], fromEnv: false });
    if (cmd === "setup_suggestion") return Promise.resolve({ kind: "none" });
    if (cmd === "groups_get") return Promise.resolve({ groups: [{ id: "g1", name: "Clients", parent: null }], members: { p1: "g1" }, rev: 1 });
    if (cmd === "activity_get" || cmd === "project_icons_list") return Promise.resolve({});
    if (cmd === "skills_scan") return Promise.resolve({ skills: [] }); // the sidebar checklist reads it
    return Promise.resolve(null);
  },
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: () => Promise.resolve(() => {}) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: () => Promise.resolve(null) }));

const base = { hidden: false, number: null, comment: "" };
const main = { ...base, path: "C:/w/app", branch: "main", head: "abc1234", isMain: true };
const ws = { ...base, path: "C:/w/ws/fix", branch: "fix", head: "c3c3c3c", isMain: false };
type Session = { key: number; agent: string; title: string; cwd: string | null; running: boolean };
let doc: FakeDocument;
let unmount: () => Promise<void> = async () => {};

beforeEach(() => {
  const dom = installDom();
  doc = dom.doc;
  Object.assign(dom.win, { setInterval, clearInterval, setTimeout, clearTimeout });
  Object.assign(doc, { querySelectorAll: () => [], querySelector: () => null, visibilityState: "visible", hidden: false });
  h.calls = [];
  h.settings = {};
});
afterEach(async () => {
  await unmount();
  unmount = async () => {};
});

async function panel(sessions: Session[] = [], settings: Record<string, unknown> = {}) {
  const { default: ProjectsPanel } = await import("./ProjectsPanel");
  const props = {
    openDirs: [], sessions, states: {}, unread: new Set<string>(), onUnread: () => {}, settings, onSetting: () => {},
    activeDir: null, onSelect: () => {}, onRemoved: () => {}, onSleep: () => {}, agents: [], launching: false, onLaunch: () => {},
    defaultId: "claude", onSetDefault: () => {}, onChoose: () => {}, page: null, onPage: () => {}, refresh: 0, onIndex: () => {},
    createRequest: 0, deleteRequest: 0, onStartIn: () => {}, nest: true, onNest: () => {}, artifactsOn: false, onArtifacts: () => {},
  };
  const m = await mount(createElement(ProjectsPanel, props as never), doc);
  unmount = m.unmount;
  await settle(120);
  return m.container as FakeNode;
}
const hasClass = (n: FakeNode, c: string) => String(n.attrs.className ?? n.attrs.class ?? "").split(" ").includes(c);
const attr = (c: FakeNode, name: string) => find(c, (n) => n.attrs[name] !== undefined)[0];
const menu = (c: FakeNode) => find(c, (n) => n.attrs.role === "menu")[0];
const items = (c: FakeNode) => find(menu(c), (n) => n.attrs.role === "menuitem").map((n) => n.textContent.trim());
const rightClick = async (c: FakeNode, target: FakeNode) => {
  await fire(c, "contextmenu", target, { clientX: 10, clientY: 10, altKey: false });
  await settle(40);
};
const ask = (c: FakeNode) => byLabel(c, "div", "Remove project")[0];

test("the footer has no Check for updates button and the pane lists no terminal rows", async () => {
  const c = await panel([{ key: 1, agent: "claude", title: "a", cwd: "C:/w/app", running: true }]);
  expect(byLabel(c, "button", "Check for updates")).toEqual([]);
  expect(find(c, (n) => n.attrs["data-pane"] !== undefined)).toEqual([]);
});

test("the project header's hover X asks under the header, names the running terminals, and removes", async () => {
  const c = await panel([{ key: 1, agent: "claude", title: "a", cwd: "C:/w/app", running: true }]);
  expect(ask(c)).toBeUndefined();
  await click(c, attr(c, "data-proj-x"));
  expect(ask(c).textContent).toContain("The folder and its files stay on disk.");
  expect(ask(c).textContent).toContain("1 terminal is still running and will be closed.");
  await click(c, byText(c, "button", "Remove app")[0]);
  await settle(40);
  expect(h.calls).toContain("project_remove");
});

test("the running-terminal line is left out when the ask is switched off or nothing runs", async () => {
  const c = await panel([{ key: 1, agent: "claude", title: "a", cwd: "C:/w/app", running: true }], { confirmCloseRunning: false });
  await click(c, attr(c, "data-proj-x"));
  expect(ask(c).textContent).not.toContain("still running");
  await unmount();
  const d = await panel([]);
  await click(d, attr(d, "data-proj-x"));
  expect(ask(d).textContent).not.toContain("still running");
});

test("right-click on the project header lists Remove project last; Escape closes the menu", async () => {
  const c = await panel();
  await rightClick(c, find(c, (n) => hasClass(n, "proj"))[0]);
  expect(items(c)).toEqual(["New workspace", "Project settings", "Remove project…"]);
  await fire(doc, "keydown", doc, { key: "Escape" });
  expect(menu(c)).toBeUndefined();
});

test("the main checkout row has a menu with Remove project and the header X asks the same question", async () => {
  const c = await panel();
  await rightClick(c, find(c, (n) => hasClass(n, "branch"))[0]);
  const list = items(c);
  expect(list[list.length - 1]).toBe("Remove project…");
  expect(list).not.toContain("Delete");
  await click(c, byText(c, "button", "Remove project…")[0]);
  expect(ask(c)).toBeDefined();
  await click(c, byText(c, "button", "Keep it")[0]);
  await click(c, attr(c, "data-proj-x"));
  expect(ask(c)).toBeDefined();
});

test("a workspace menu opens from the wrapper outside the row too, and Hide is in it", async () => {
  const c = await panel();
  await rightClick(c, find(c, (n) => n.attrs["data-path"] === ws.path)[0]);
  expect(items(c)).toContain("Hide from the sidebar");
  expect(items(c)).toContain("Delete");
  await click(c, byText(c, "button", "Hide from the sidebar")[0]);
  await settle(40);
  expect(h.calls).toContain("workspace_hide");
  expect(menu(c)).toBeUndefined();
});

test("a group row has a menu and a hover X, both asking Delete group", async () => {
  const c = await panel();
  await rightClick(c, find(c, (n) => hasClass(n, "sb-group-row"))[0]);
  expect(items(c)).toEqual(["Group settings", "Delete group…"]);
  await click(c, byText(c, "button", "Delete group…")[0]);
  expect(find(c, (n) => n.textContent.includes("Delete Clients?")).length).toBeGreaterThan(0);
  await click(c, byText(c, "button", "Keep it")[0]);
  await click(c, attr(c, "data-group-x"));
  expect(find(c, (n) => n.textContent.includes("Delete Clients?")).length).toBeGreaterThan(0);
});

test("Remove project from the header X goes to project_remove, never to workspace_remove", async () => {
  const c = await panel();
  await click(c, attr(c, "data-proj-x"));
  await click(c, attr(c, "data-remove-project-yes"));
  await settle(40);
  expect(h.calls).toContain("project_remove");
  expect(h.calls).not.toContain("workspace_remove");
});

test("a clean workspace with quick delete on still asks while a terminal runs below its folder", async () => {
  h.settings = { confirmWorkspaceDelete: false };
  const c = await panel([{ key: 1, agent: "claude", title: "a", cwd: "C:\\w\\ws\\fix\\src", running: true }]);
  await click(c, find(c, (n) => String(n.attrs.title ?? "").startsWith("Delete this workspace"))[0]);
  await settle(60);
  expect(find(c, (n) => n.textContent.includes("1 terminal is still running and will be closed.")).length).toBeGreaterThan(0);
  expect(h.calls).not.toContain("workspace_remove");
});

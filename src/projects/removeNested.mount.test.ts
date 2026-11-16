// PROJ 008 / F21 (job 65): removing a project, or deleting a group with its projects, leaves the files on disk, and the
// engine ends only the removed projects' terminals (job 52: the deepest project folder or worktree that holds a
// terminal's folder owns it). The real ProjectsPanel on the small DOM, backend mocked (harness as in
// groupDeleteCloses.mount.test.ts): a project "inner" lies inside "app" and stays, with a worktree inside app too.
import { createElement } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { type FakeDocument, type FakeNode, byLabel, byText, click, installDom, mount, settle } from "../tasks/fakeDom";

const h = vi.hoisted(() => ({ calls: [] as string[], unsaved: [] as string[][], closed: [] as unknown[][], removed: [] as string[] }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args: Record<string, unknown> = {}) => {
    h.calls.push(cmd);
    if (cmd === "get_settings") return Promise.resolve({});
    if (cmd === "workspace_statuses") return Promise.resolve({ list: [] });
    if (cmd === "visibility_get") return Promise.resolve([]);
    if (cmd === "project_list")
      return Promise.resolve([
        { id: "p1", name: "app", path: "C:/w/app" },
        { id: "p2", name: "inner", path: "C:/w/app/inner" },
      ]);
    if (cmd === "workspace_scan") return Promise.resolve({ list: args.projectId === "p1" ? [appMain, appFix] : [innerMain, innerWt], unseen: [] });
    if (cmd === "workspaces_place_get") return Promise.resolve({ dir: "", flat: false, used: [], fromEnv: false });
    if (cmd === "setup_suggestion") return Promise.resolve({ kind: "none" });
    if (cmd === "groups_get") return Promise.resolve({ groups: [{ id: "g1", name: "Clients", parent: null }], members: { p1: "g1" }, rev: 1 });
    if (cmd === "group_delete") return Promise.resolve({ groups: [], members: {}, rev: 2 });
    if (cmd === "project_remove") return Promise.resolve({ name: "app", path: "C:/w/app", ended: 2 });
    if (cmd === "activity_get" || cmd === "project_icons_list") return Promise.resolve({});
    if (cmd === "skills_scan") return Promise.resolve({ skills: [] });
    return Promise.resolve(null);
  },
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: () => Promise.resolve(() => {}) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: () => Promise.resolve(null) }));

const base = { hidden: false, number: null, comment: "" };
const appMain = { ...base, path: "C:/w/app", branch: "main", head: "abc1234", isMain: true };
const appFix = { ...base, path: "C:/w/ws/fix", branch: "fix", head: "c3c3c3c", isMain: false }; // outside the project folder
const innerMain = { ...base, path: "C:/w/app/inner", branch: "main", head: "def5678", isMain: true };
const innerWt = { ...base, path: "C:/w/app/wts/inner-b", branch: "b", head: "e4e4e4e", isMain: false }; // inside app's folder
const running = (key: number, cwd: string) => ({ key, agent: "claude", title: String(key), cwd, running: true });
// app's own two, and two of inner (one in its folder, one in its worktree inside app)
const sessions = [running(1, "C:/w/app"), running(2, "C:/w/ws/fix"), running(3, "C:/w/app/inner/src"), running(4, "C:/w/app/wts/inner-b")];
let doc: FakeDocument;
let unmount: () => Promise<void> = async () => {};

beforeEach(() => {
  const dom = installDom();
  doc = dom.doc;
  Object.assign(dom.win, { setInterval, clearInterval, setTimeout, clearTimeout });
  Object.assign(doc, { querySelectorAll: () => [], querySelector: () => null, visibilityState: "visible", hidden: false });
  h.calls = [];
  h.unsaved = [];
  h.closed = [];
  h.removed = [];
});
afterEach(async () => {
  await unmount();
  unmount = async () => {};
});

async function panel() {
  const { default: ProjectsPanel } = await import("./ProjectsPanel");
  const props = {
    openDirs: ["C:/w/app", "C:/w/ws/fix", "C:/w/app/inner", "C:/w/app/wts/inner-b"], sessions, states: {}, unread: new Set<string>(), onUnread: () => {}, settings: {}, onSetting: () => {},
    activeDir: null, onSelect: () => {}, onRemoved: (path: string) => void h.removed.push(path), onSleep: () => {}, agents: [], launching: false, onLaunch: () => {},
    defaultId: "claude", onSetDefault: () => {}, onChoose: () => {}, page: null, onPage: () => {}, refresh: 0, onIndex: () => {},
    createRequest: 0, deleteRequest: 0, onStartIn: () => {}, nest: true, onNest: () => {}, artifactsOn: false, onArtifacts: () => {},
    onAskUnsaved: async (paths: string[]) => (h.unsaved.push(paths), true),
    onRemovedAll: (paths: string[], staying?: string[]) => void h.closed.push([paths, staying]),
  };
  const m = await mount(createElement(ProjectsPanel, props as never), doc);
  unmount = m.unmount;
  await settle(120);
  return m.container as FakeNode;
}
const ask = (c: FakeNode) => byLabel(c, "div", "Remove project")[0];
async function removeApp(c: FakeNode) {
  await click(c, byLabel(c, "button", "Remove app")[0]);
  await settle(20);
}
async function askGroupDelete(c: FakeNode) {
  await click(c, byLabel(c, "button", "Delete group Clients")[0]);
  await settle(20);
  const box = byLabel(c, "input", "also remove the projects")[0];
  Object.assign(box, { checked: true });
  await click(c, box);
  await settle(20);
}
const inner = ["C:/w/app/inner", "C:/w/app/wts/inner-b"];

test("PROJ 008: the unsaved-tabs question before a removal asks only about the removed project's open folders", async () => {
  const c = await panel();
  await removeApp(c);
  await click(c, byText(c, "button", "Remove app")[0]);
  await settle(40);
  expect(h.unsaved).toEqual([["C:/w/app", "C:/w/ws/fix"]]);
});

test("F21: the unsaved-tabs question before a group delete asks only about the group's projects' open folders", async () => {
  const c = await panel();
  await askGroupDelete(c);
  await click(c, byText(c, "button", "Delete group")[0]);
  await settle(60);
  expect(h.unsaved).toEqual([["C:/w/app", "C:/w/ws/fix"]]);
});

test("PROJ 008: the removal question counts only the removed project's running terminals", async () => {
  const c = await panel();
  await removeApp(c);
  expect(ask(c).textContent).toContain("2 terminals are still running and will be closed.");
});

test("F21: the group delete question counts only the running terminals of the projects in the group", async () => {
  const c = await panel();
  await askGroupDelete(c);
  const q = byLabel(c, "div", "Delete group")[0] ?? c;
  expect(q.textContent).toContain("2 terminals are still running and will be closed.");
});

test("PROJ 008: removing a project closes its panes but hands over the nested project that stays", async () => {
  const c = await panel();
  await removeApp(c);
  await click(c, byText(c, "button", "Remove app")[0]);
  await settle(40);
  expect(h.calls).toContain("project_remove");
  expect(h.closed.length).toBe(1);
  const [paths, staying] = h.closed[0] as [string[], string[]];
  expect(paths).toEqual(["C:/w/app"]);
  expect(staying).toEqual(expect.arrayContaining(inner));
  expect(staying).not.toContain("C:/w/app");
  expect(staying).not.toContain("C:/w/ws/fix");
});

test("F21: deleting a group with its projects hands over the projects outside the group as staying", async () => {
  const c = await panel();
  await askGroupDelete(c);
  await click(c, byText(c, "button", "Delete group")[0]);
  await settle(60);
  expect(h.closed.length).toBe(1);
  const [paths, staying] = h.closed[0] as [string[], string[]];
  expect(paths).toEqual(["C:/w/app"]);
  expect(staying).toEqual(expect.arrayContaining(inner));
  expect(staying).not.toContain("C:/w/app");
});

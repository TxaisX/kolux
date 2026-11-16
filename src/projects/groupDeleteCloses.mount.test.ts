// Audit F21 (screen half) on the real ProjectsPanel (small DOM, backend mocked, harness as in uxRows5.test.ts):
// "Delete group" with "Also remove its projects" does what removing one project does. It asks about the
// unsaved editor tabs of the member projects' folders and worktrees first (Cancel: nothing is deleted and the
// question stays), and after group_delete answers it closes their panes through onRemovedAll. Unticked, nothing
// is asked or closed. A failed group_delete closes nothing.
import { createElement } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { type FakeDocument, type FakeNode, byLabel, byText, click, find, installDom, mount, settle } from "../tasks/fakeDom";

const h = vi.hoisted(() => ({ calls: [] as { cmd: string; args: Record<string, unknown> }[], answer: true, failDelete: false, unsaved: [] as string[][], closed: [] as string[][] }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args: Record<string, unknown> = {}) => {
    h.calls.push({ cmd, args });
    const groups = [
      { id: "g1", name: "Clients", parent: null },
      { id: "g2", name: "Inner", parent: "g1" },
    ];
    if (cmd === "get_settings") return Promise.resolve({});
    if (cmd === "workspace_statuses") return Promise.resolve({ list: [] });
    if (cmd === "visibility_get") return Promise.resolve([]);
    if (cmd === "project_list")
      return Promise.resolve([
        { id: "p1", name: "app", path: "C:/w/app" },
        { id: "p2", name: "lib", path: "C:/w/lib" },
        { id: "p3", name: "other", path: "C:/w/other" },
      ]);
    if (cmd === "workspace_scan") return Promise.resolve({ list: args.projectId === "p1" ? [main, fix] : [], unseen: [] });
    if (cmd === "workspaces_place_get") return Promise.resolve({ dir: "", flat: false, used: [], fromEnv: false });
    if (cmd === "setup_suggestion") return Promise.resolve({ kind: "none" });
    if (cmd === "groups_get") return Promise.resolve({ groups, members: { p1: "g1", p2: "g2" }, rev: 1 });
    if (cmd === "group_delete") return h.failDelete ? Promise.reject("the store is locked") : Promise.resolve({ groups: [], members: {}, rev: 2 });
    if (cmd === "activity_get" || cmd === "project_icons_list") return Promise.resolve({});
    if (cmd === "skills_scan") return Promise.resolve({ skills: [] });
    return Promise.resolve(null);
  },
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: () => Promise.resolve(() => {}) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: () => Promise.resolve(null) }));

const base = { hidden: false, number: null, comment: "" };
const main = { ...base, path: "C:/w/app", branch: "main", head: "abc1234", isMain: true };
// a worktree in the default workspaces folder, outside the project folder
const fix = { ...base, path: "C:/w/ws/app-fix", branch: "fix", head: "c3c3c3c", isMain: false };
let doc: FakeDocument;
let unmount: () => Promise<void> = async () => {};

beforeEach(() => {
  const dom = installDom();
  doc = dom.doc;
  Object.assign(dom.win, { setInterval, clearInterval, setTimeout, clearTimeout });
  Object.assign(doc, { querySelectorAll: () => [], querySelector: () => null, visibilityState: "visible", hidden: false });
  h.calls = [];
  h.answer = true;
  h.failDelete = false;
  h.unsaved = [];
  h.closed = [];
});
afterEach(async () => {
  await unmount();
  unmount = async () => {};
});

async function panel() {
  const { default: ProjectsPanel } = await import("./ProjectsPanel");
  const props = {
    openDirs: ["C:/w/app", fix.path, "C:/w/lib", "C:/w/other"], sessions: [], states: {}, unread: new Set<string>(), onUnread: () => {}, settings: {}, onSetting: () => {},
    activeDir: null, onSelect: () => {}, onRemoved: () => {}, onSleep: () => {}, agents: [], launching: false, onLaunch: () => {},
    defaultId: "claude", onSetDefault: () => {}, onChoose: () => {}, page: null, onPage: () => {}, refresh: 0, onIndex: () => {},
    createRequest: 0, deleteRequest: 0, onStartIn: () => {}, nest: true, onNest: () => {}, artifactsOn: false, onArtifacts: () => {},
    onAskUnsaved: async (paths: string[]) => (h.unsaved.push(paths), h.answer),
    onRemovedAll: (paths: string[]) => void h.closed.push(paths),
  };
  const m = await mount(createElement(ProjectsPanel, props as never), doc);
  unmount = m.unmount;
  await settle(120);
  return m.container as FakeNode;
}
const deletes = () => h.calls.filter((x) => x.cmd === "group_delete").map((x) => x.args);
const question = (c: FakeNode) => find(c, (n) => n.attrs.role === "alertdialog" && n.textContent.includes("Delete Clients?"));
async function askDelete(c: FakeNode, remove: boolean) {
  await click(c, byLabel(c, "button", "Delete group Clients")[0]);
  await settle(20);
  if (remove) {
    const box = byLabel(c, "input", "also remove the projects")[0];
    Object.assign(box, { checked: true }); // the browser ticks the box, then React reads it in the click
    await click(c, box);
    await settle(20);
  }
  await click(c, byText(c, "button", "Delete group")[0]);
  await settle(60);
}

test("with the projects removed too, their unsaved tabs are asked about first, then their panes close", async () => {
  const c = await panel();
  await askDelete(c, true);
  // the folders of every project in the group and its sub-group, and the project's worktree outside its folder
  expect(h.unsaved).toEqual([["C:/w/app", fix.path, "C:/w/lib"]]);
  expect(deletes()).toEqual([{ id: "g1", removeProjects: true }]);
  expect(h.closed).toEqual([["C:/w/app", fix.path, "C:/w/lib"]]); // F88-01: the going folders, the worktree too
  expect(question(c).length).toBe(0);
});

test("Cancel on the unsaved-tabs question deletes nothing, closes nothing, and the question stays", async () => {
  h.answer = false;
  const c = await panel();
  await askDelete(c, true);
  expect(h.unsaved).toEqual([["C:/w/app", fix.path, "C:/w/lib"]]);
  expect(deletes()).toEqual([]);
  expect(h.closed).toEqual([]);
  expect(question(c).length).toBe(1);
});

test("with the projects kept, nothing is asked and no pane closes", async () => {
  const c = await panel();
  await askDelete(c, false);
  expect(deletes()).toEqual([{ id: "g1", removeProjects: false }]);
  expect(h.unsaved).toEqual([]);
  expect(h.closed).toEqual([]);
});

test("a failed group_delete closes no pane", async () => {
  h.failDelete = true;
  const c = await panel();
  await askDelete(c, true);
  expect(deletes().length).toBe(1);
  expect(h.closed).toEqual([]);
});

// PROJ 008 / F21 (job 66, the page's side of job 64's F1): two projects on ONE Git repository. "app" is the main
// checkout, "app-b" a linked worktree of it, and Git lists every worktree to both, so each lists the other's folder and
// the shared "wt3". A shared folder goes only as the removed project's own folder. The real ProjectsPanel on the small
// DOM, backend mocked as in removeNested.mount.test.ts.
import { createElement } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { type FakeDocument, type FakeNode, byLabel, byText, click, installDom, mount, settle } from "../tasks/fakeDom";

const h = vi.hoisted(() => ({ unsaved: [] as string[][], closed: [] as unknown[][] }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args: Record<string, unknown> = {}) => {
    if (cmd === "get_settings") return Promise.resolve({});
    if (cmd === "workspace_statuses") return Promise.resolve({ list: [] });
    if (cmd === "visibility_get") return Promise.resolve([]);
    if (cmd === "project_list")
      return Promise.resolve([
        { id: "p1", name: "app", path: "C:/w/app" },
        { id: "p2", name: "app-b", path: "C:/w/app-b" },
      ]);
    // the same repository from either side: every worktree, the main checkout marked
    if (cmd === "workspace_scan") return Promise.resolve({ list: [appMain, appB, wt3], unseen: [] });
    if (cmd === "workspaces_place_get") return Promise.resolve({ dir: "", flat: false, used: [], fromEnv: false });
    if (cmd === "setup_suggestion") return Promise.resolve({ kind: "none" });
    if (cmd === "groups_get") return Promise.resolve({ groups: [{ id: "g1", name: "Clients", parent: null }], members: { p1: "g1", p2: "g1" }, rev: 1 });
    if (cmd === "group_delete") return Promise.resolve({ groups: [], members: {}, rev: 2 });
    if (cmd === "project_remove") return Promise.resolve(args.projectId === "p1" ? { name: "app", path: "C:/w/app", ended: 1 } : { name: "app-b", path: "C:/w/app-b", ended: 1 });
    if (cmd === "activity_get" || cmd === "project_icons_list") return Promise.resolve({});
    if (cmd === "skills_scan") return Promise.resolve({ skills: [] });
    return Promise.resolve(null);
  },
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: () => Promise.resolve(() => {}) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: () => Promise.resolve(null) }));

const base = { hidden: false, number: null, comment: "" };
const appMain = { ...base, path: "C:/w/app", branch: "main", head: "abc1234", isMain: true };
const appB = { ...base, path: "C:/w/app-b", branch: "b", head: "b2b2b2b", isMain: false };
const wt3 = { ...base, path: "C:/w/wt3", branch: "three", head: "c3c3c3c", isMain: false };
const running = (key: number, cwd: string) => ({ key, agent: "claude", title: String(key), cwd, running: true });
const sessions = [running(1, "C:/w/app"), running(2, "C:/w/app-b"), running(3, "C:/w/wt3")];
let doc: FakeDocument;
let unmount: () => Promise<void> = async () => {};

beforeEach(() => {
  const dom = installDom();
  doc = dom.doc;
  Object.assign(dom.win, { setInterval, clearInterval, setTimeout, clearTimeout });
  Object.assign(doc, { querySelectorAll: () => [], querySelector: () => null, visibilityState: "visible", hidden: false });
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
    openDirs: ["C:/w/app", "C:/w/app-b", "C:/w/wt3"], sessions, states: {}, unread: new Set<string>(), onUnread: () => {}, settings: {}, onSetting: () => {},
    activeDir: null, onSelect: () => {}, onRemoved: () => {}, onSleep: () => {}, agents: [], launching: false, onLaunch: () => {},
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

test.each([
  ["app-b", "C:/w/app-b"],
  ["app", "C:/w/app"],
])("g/h: removing %s counts, asks about and closes only its own folder, not the other project's or the shared worktree", async (name, path) => {
  const c = await panel();
  await click(c, byLabel(c, "button", `Remove ${name}`)[0]);
  await settle(20);
  expect(ask(c).textContent).toContain("1 terminal is still running and will be closed.");
  await click(c, byText(c, "button", `Remove ${name}`)[0]);
  await settle(40);
  expect(h.unsaved).toEqual([[path]]);
  expect((h.closed[0] as [string[]])[0]).toEqual([path]);
});

test("k: deleting a group that removes both projects counts and asks about every folder", async () => {
  const c = await panel();
  await click(c, byLabel(c, "button", "Delete group Clients")[0]);
  await settle(20);
  const box = byLabel(c, "input", "also remove the projects")[0];
  Object.assign(box, { checked: true });
  await click(c, box);
  await settle(20);
  expect((byLabel(c, "div", "Delete group")[0] ?? c).textContent).toContain("3 terminals are still running and will be closed.");
  await click(c, byText(c, "button", "Delete group")[0]);
  await settle(60);
  expect([...h.unsaved[0]].sort()).toEqual(["C:/w/app", "C:/w/app-b", "C:/w/wt3"]);
});

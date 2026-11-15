// Audit F13/F14 on the real ProjectsPanel (small DOM, backend mocked, harness as in removeCommits.test.ts):
// with no worktree row under the pointer, Delete Workspace and Rename worktree act on the worktree the focused
// pane works in (`workDir`); on a main folder they say so in one line and touch nothing.
import { createElement, useState } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { type FakeDocument, type FakeNode, byText, click, find, installDom, mount, settle } from "../tasks/fakeDom";

const h = vi.hoisted(() => ({ wt: [] as unknown[], calls: [] as { cmd: string; args: Record<string, unknown> }[], unsaved: [] as string[][], listGate: null as Promise<void> | null, projects: [{ id: "p1", name: "app", path: "C:/w/app" }] as unknown[] }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args: Record<string, unknown> = {}) => {
    h.calls.push({ cmd, args });
    if (cmd === "workspace_remove_check") return Promise.resolve({ changes: [], locked: null, nested: [], commits: [], stamp: "s" });
    if (cmd === "get_settings") return Promise.resolve({});
    if (cmd === "workspace_statuses") return Promise.resolve({ list: [] });
    if (cmd === "project_list") return (h.listGate ?? Promise.resolve()).then(() => h.projects);
    if (cmd === "workspace_scan") return Promise.resolve({ list: h.wt, unseen: [] });
    if (cmd === "workspaces_place_get") return Promise.resolve({ dir: "", flat: false, used: [], fromEnv: false });
    if (cmd === "scm_prs_poll") return Promise.resolve({ prs: [], limitedUntil: null });
    if (cmd === "setup_suggestion") return Promise.resolve({ kind: "none" });
    if (cmd === "groups_get" || cmd === "activity_get" || cmd === "project_icons_list") return Promise.resolve({});
    if (cmd === "skills_scan") return Promise.resolve({ skills: [] });
    return Promise.resolve(null);
  },
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: () => Promise.resolve(() => {}) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: () => Promise.resolve(null) }));

const base = { hidden: false, number: null, comment: "" };
const main = { ...base, path: "C:/w/app", branch: "main", head: "abc1234", isMain: true };
const fix = { ...base, path: "C:/w/ws/fix-login", branch: "fix-login", head: "c3c3c3c", isMain: false };

let doc: FakeDocument;
let unmount: () => Promise<void> = async () => {};
let pressDelete: () => Promise<void> = async () => {};

beforeEach(() => {
  const dom = installDom();
  doc = dom.doc;
  Object.assign(dom.win, { setInterval, clearInterval, setTimeout, clearTimeout });
  // nothing under the pointer: worktrees have no sidebar row any more
  Object.assign(doc, { querySelectorAll: () => [], querySelector: () => null, visibilityState: "visible", hidden: false });
  h.wt = [main, fix];
  h.calls = [];
  h.unsaved = [];
  h.listGate = null;
  h.projects = [{ id: "p1", name: "app", path: "C:/w/app" }];
});
afterEach(async () => {
  await unmount();
  unmount = async () => {};
});

async function panel(workDir: string, renameRequest = 0, firstDelete = 0, wait = 120) {
  const { default: ProjectsPanel } = await import("./ProjectsPanel");
  const { act } = await import("react");
  const props = {
    openDirs: ["C:/w/app"], sessions: [], states: {}, unread: new Set<string>(), onUnread: () => {}, settings: {}, onSetting: () => {},
    activeDir: "C:/w/app", workDir, onSelect: () => {}, onRemoved: () => {}, onSleep: () => {}, agents: [], launching: false, onLaunch: () => {},
    defaultId: "claude", onSetDefault: () => {}, onChoose: () => {}, page: null, onPage: () => {}, refresh: 0, onIndex: () => {},
    createRequest: 0, onStartIn: () => {}, nest: true, onNest: () => {}, artifactsOn: false, onArtifacts: () => {},
    onAskUnsaved: async (paths: string[]) => (h.unsaved.push(paths), true), renameRequest,
  };
  const Host = () => {
    const [n, setN] = useState(firstDelete);
    pressDelete = async () => {
      await act(async () => setN((v) => v + 1));
      await settle(60);
    };
    return createElement(ProjectsPanel, { ...props, deleteRequest: n } as never);
  };
  const m = await mount(createElement(Host), doc);
  unmount = m.unmount;
  await settle(wait);
  return m.container as FakeNode;
}
const checks = () => h.calls.filter((c) => c.cmd === "workspace_remove_check").map((c) => c.args.path);
const question = (c: FakeNode) => find(c, (n) => n.attrs.role === "alertdialog" && n.textContent.includes("and its folder?"));

test("Delete Workspace on a pane in a worktree asks first, names the worktree, and checks unsaved tabs", async () => {
  const c = await panel(fix.path);
  await pressDelete();
  expect(checks()).toEqual([fix.path]);
  expect(h.calls.some((x) => x.cmd === "workspace_remove"), "nothing is deleted before the answer").toBe(false);
  expect(question(c).length).toBe(1);
  expect(question(c)[0].textContent).toContain("fix-login");
  await click(c, byText(c, "button", "Delete")[0]);
  await settle(60);
  expect(h.unsaved).toEqual([[fix.path]]);
  expect(h.calls.filter((x) => x.cmd === "workspace_remove").map((x) => x.args.path)).toEqual([fix.path]);
});

test("Delete Workspace on a pane in the project's main folder says so and checks nothing", async () => {
  const c = await panel(main.path);
  await pressDelete();
  expect(checks()).toEqual([]);
  expect(question(c).length).toBe(0);
  expect(c.textContent).toContain("The pane you are in is not in a worktree, so there is nothing to delete.");
});

// Review R27-01: the shortcut opens a closed sidebar, so the panel mounts with the press already made and
// an empty project list. It waits for the lists rather than saying "not in a worktree" and using up the press.
test("Delete Workspace pressed with the sidebar closed waits for the lists, then asks about the focused pane's worktree", async () => {
  let open = () => {};
  h.listGate = new Promise<void>((r) => (open = r));
  const c = await panel(fix.path, 0, 7, 20); // 7: a press count no earlier test in this file has served
  expect(c.textContent).not.toContain("not in a worktree");
  open();
  await settle(120);
  expect(c.textContent).not.toContain("not in a worktree");
  expect(checks()).toEqual([fix.path]);
  expect(question(c).length).toBe(1);
  expect(question(c)[0].textContent).toContain("fix-login");
});

test("Delete Workspace pressed with the sidebar closed and no projects at all says so once the list comes in", async () => {
  h.projects = [];
  const c = await panel(fix.path, 0, 9);
  expect(checks()).toEqual([]);
  expect(c.textContent).toContain("The pane you are in is not in a worktree, so there is nothing to delete.");
});

test("Rename worktree opens the name field of the focused pane's worktree", async () => {
  const c = await panel(fix.path, 1);
  const field = find(c, (n) => n.attrs["aria-label"] === "Workspace name");
  expect(field.length).toBe(1);
});

test("Rename worktree on the main folder says so and opens no field", async () => {
  const c = await panel(main.path, 1);
  expect(find(c, (n) => n.attrs["aria-label"] === "Workspace name").length).toBe(0);
  expect(c.textContent).toContain("The pane you are in is not in a worktree, so there is nothing to rename.");
});

// Audit F19: the back end does not drop a worktree's unsaved editor drafts when it removes the folder
// (`workspace_remove` in src-tauri/src/projects.rs never calls editor_drafts), so the children-first batch
// delete drops them per removed folder, as the single delete does.
test("Deleting a worktree with a child worktree drops the editor drafts of each one removed", async () => {
  const kid = { ...base, path: "C:/w/ws/fix-login-kid", branch: "fix-login-kid", head: "d4d4d4d", isMain: false, parent: fix.path };
  h.wt = [main, { ...fix, parent: main.path }, kid];
  const c = await panel(fix.path);
  await pressDelete();
  await click(c, byText(c, "button", "Delete all")[0]);
  await settle(60);
  expect(h.calls.filter((x) => x.cmd === "workspace_remove").map((x) => x.args.path)).toEqual([kid.path, fix.path]);
  expect(h.calls.filter((x) => x.cmd === "editor_drafts_drop").map((x) => x.args.worktree)).toEqual([kid.path, fix.path]);
});

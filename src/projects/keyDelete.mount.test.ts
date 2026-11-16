// Audit F13/F14 on the real ProjectsPanel (small DOM, backend mocked, harness as in removeCommits.test.ts):
// with no worktree row under the pointer, Delete worktree and Rename worktree act on the worktree the focused
// pane works in (`workDir`); on a main folder they say so in one line and touch nothing.
import { createElement, useState } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { type FakeDocument, type FakeNode, byText, click, find, installDom, mount, settle } from "../tasks/fakeDom";

const h = vi.hoisted(() => ({ wt: [] as unknown[], calls: [] as { cmd: string; args: Record<string, unknown> }[], unsaved: [] as string[][], listGate: null as Promise<void> | null, settings: {} as Record<string, unknown>, projects: [{ id: "p1", name: "app", path: "C:/w/app" }] as unknown[] }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args: Record<string, unknown> = {}) => {
    h.calls.push({ cmd, args });
    if (cmd === "workspace_remove_check") return Promise.resolve({ changes: [], locked: null, nested: [], commits: [], stamp: "s" });
    if (cmd === "get_settings") return Promise.resolve(h.settings);
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
let focusOn: (dir: string) => Promise<void> = async () => {};
let activeDir: string | null = "C:/w/app"; // the folder of the pane in front; null when no pane is focused

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
  h.settings = {};
  h.projects = [{ id: "p1", name: "app", path: "C:/w/app" }];
  activeDir = "C:/w/app";
});
afterEach(async () => {
  await unmount();
  unmount = async () => {};
});

async function panel(workDir: string | null, renameRequest = 0, firstDelete = 0, wait = 120, more: Record<string, unknown> = {}) {
  const { default: ProjectsPanel } = await import("./ProjectsPanel");
  const { act } = await import("react");
  const props = {
    openDirs: ["C:/w/app"], sessions: [], states: {}, unread: new Set<string>(), onUnread: () => {}, settings: {}, onSetting: () => {},
    activeDir, workDir, onSelect: () => {}, onRemoved: () => {}, onSleep: () => {}, agents: [], launching: false, onLaunch: () => {},
    defaultId: "claude", onSetDefault: () => {}, onChoose: () => {}, page: null, onPage: () => {}, refresh: 0, onIndex: () => {},
    createRequest: 0, onStartIn: () => {}, nest: true, onNest: () => {}, artifactsOn: false, onArtifacts: () => {},
    onAskUnsaved: async (paths: string[]) => (h.unsaved.push(paths), true), renameRequest, ...more,
  };
  const Host = () => {
    const [n, setN] = useState(firstDelete);
    const [dir, setDir] = useState(workDir);
    pressDelete = async () => {
      await act(async () => setN((v) => v + 1));
      await settle(60);
    };
    focusOn = async (d) => {
      await act(async () => setDir(d));
      await settle(20);
    };
    return createElement(ProjectsPanel, { ...props, workDir: dir, deleteRequest: n } as never);
  };
  const m = await mount(createElement(Host), doc);
  unmount = m.unmount;
  await settle(wait);
  return m.container as FakeNode;
}
const checks = () => h.calls.filter((c) => c.cmd === "workspace_remove_check").map((c) => c.args.path);
const question = (c: FakeNode) => find(c, (n) => n.attrs.role === "alertdialog" && n.textContent.includes("and its folder?"));

test("Delete worktree on a pane in a worktree asks first, names the worktree, and checks unsaved tabs", async () => {
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

test("Delete worktree on a pane in the project's main folder says so and checks nothing", async () => {
  const c = await panel(main.path);
  await pressDelete();
  expect(checks()).toEqual([]);
  expect(question(c).length).toBe(0);
  expect(c.textContent).toContain("The pane you are in is not in a worktree, so there is nothing to delete.");
});

// Review R27-01: the shortcut opens a closed sidebar, so the panel mounts with the press already made and
// an empty project list. It waits for the lists rather than saying "not in a worktree" and using up the press.
test("Delete worktree pressed with the sidebar closed waits for the lists, then asks about the focused pane's worktree", async () => {
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

// Review R35-01: a press held for the lists is served later only within 10 seconds of the panel first seeing it,
// and only while the focused pane is in the same folder; otherwise it is dropped with no check and no question.
test("a press still held when the sidebar closes is dropped once 10 seconds have gone by", async () => {
  h.listGate = new Promise<void>(() => {}); // the list never answers while the sidebar is open
  await panel(fix.path, 0, 11, 20); // 11: a press count no earlier test in this file has served
  await unmount();
  unmount = async () => {};
  h.listGate = null;
  const later = Date.now() + 11_000;
  const clock = vi.spyOn(Date, "now").mockReturnValue(later);
  try {
    const c = await panel(fix.path, 0, 11);
    expect(checks()).toEqual([]);
    expect(question(c).length).toBe(0);
  } finally {
    clock.mockRestore();
  }
});

// Review R42-04: a clock set back between first seen and the lists coming in gives a negative age, which is too old too.
test("a press still held when the clock is set back is dropped, not served", async () => {
  h.listGate = new Promise<void>(() => {}); // the list never answers while the sidebar is open
  await panel(fix.path, 0, 15, 20); // 15: a press count no earlier test in this file has served
  await unmount();
  unmount = async () => {};
  h.listGate = null;
  const earlier = Date.now() - 60_000;
  const clock = vi.spyOn(Date, "now").mockReturnValue(earlier);
  try {
    const c = await panel(fix.path, 0, 15);
    expect(checks()).toEqual([]);
    expect(question(c).length).toBe(0);
  } finally {
    clock.mockRestore();
  }
});

test("a press held for the lists is dropped when the focus moves to another worktree first", async () => {
  const other = { ...base, path: "C:/w/ws/other", branch: "other", head: "e5e5e5e", isMain: false };
  h.wt = [main, fix, other];
  let open = () => {};
  h.listGate = new Promise<void>((r) => (open = r));
  const c = await panel(fix.path, 0, 13, 20); // 13: a press count no earlier test in this file has served
  await focusOn(other.path);
  open();
  await settle(120);
  expect(checks()).toEqual([]);
  expect(question(c).length).toBe(0);
});

// Pins for behaviour the R35-01 fix already has (review R42): a held press with no focused folder, a remount
// inside 10 seconds, and a hovered row on a held press.
test("a press held with no folder focused, and none when the lists come in, is served", async () => {
  activeDir = null;
  let open = () => {};
  h.listGate = new Promise<void>((r) => (open = r));
  const c = await panel(null, 0, 17, 20); // 17: a press count no earlier test in this file has served
  expect(c.textContent).not.toContain("not in a worktree");
  open();
  await settle(120);
  expect(checks()).toEqual([]);
  expect(c.textContent).toContain("The pane you are in is not in a worktree, so there is nothing to delete.");
});

test("a press held when the sidebar closes is served and asks when it opens again inside 10 seconds on the same folder", async () => {
  h.listGate = new Promise<void>(() => {}); // the list never answers while the sidebar is open
  await panel(fix.path, 0, 19, 20); // 19: a press count no earlier test in this file has served
  await unmount();
  unmount = async () => {};
  h.listGate = null;
  const c = await panel(fix.path, 0, 19);
  expect(checks()).toEqual([fix.path]);
  expect(question(c).length).toBe(1);
  expect(question(c)[0].textContent).toContain("fix-login");
});

test("a held press asks about the focused pane's worktree, not a row hovered when the lists come in", async () => {
  const other = { ...base, path: "C:/w/ws/other", branch: "other", head: "e5e5e5e", isMain: false };
  h.wt = [main, fix, other];
  let open = () => {};
  h.listGate = new Promise<void>((r) => (open = r));
  const c = await panel(fix.path, 0, 21, 20); // 21: a press count no earlier test in this file has served
  Object.assign(doc, { querySelectorAll: (sel: string) => (sel.includes(":hover") ? [{ dataset: { path: other.path } }] : []) });
  open();
  await settle(120);
  expect(checks()).toEqual([fix.path]);
  expect(question(c).length).toBe(1);
  expect(question(c)[0].textContent).toContain("fix-login");
  expect(question(c)[0].textContent).not.toContain("other");
});

test("Delete worktree pressed with the sidebar closed and no projects at all says so once the list comes in", async () => {
  h.projects = [];
  const c = await panel(fix.path, 0, 9);
  expect(checks()).toEqual([]);
  expect(c.textContent).toContain("The pane you are in is not in a worktree, so there is nothing to delete.");
});

// Review R27-02: a worktree the user hid (or one made outside Kolux) is not in the list the key searches. The
// note says Kolux does not list it, rather than that the pane is not in a worktree; nothing is checked or deleted.
test("Delete worktree on a pane in a hidden worktree says Kolux does not list it, and deletes nothing", async () => {
  h.wt = [main, { ...fix, hidden: true }];
  const c = await panel(fix.path);
  await pressDelete();
  expect(checks()).toEqual([]);
  expect(c.textContent).not.toContain("not in a worktree");
  expect(c.textContent).toContain("Kolux does not list this worktree, so it cannot delete it from here.");
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

// Review R27-05: the shortcut picks its target by pane focus, so it always asks, even with "ask before deleting"
// (and "ask before closing") switched off. The setting keeps governing Delete in the pane's worktree label menu.
const allOffSettings = { confirmWorkspaceDelete: false, confirmCloseRunning: false };
const removed = () => h.calls.filter((x) => x.cmd === "workspace_remove").map((x) => x.args.path);

test("the delete shortcut on the focused pane asks even with both questions switched off", async () => {
  h.settings = allOffSettings;
  const c = await panel(fix.path, 0, 0, 120, { settings: allOffSettings }); // mounts with no press: a count that went back resets the served one
  await pressDelete();
  expect(checks()).toEqual([fix.path]);
  expect(question(c).length).toBe(1);
  expect(question(c)[0].textContent).toContain("fix-login");
  expect(removed()).toEqual([]);
});

test("the delete shortcut over a hovered worktree row asks even with both questions switched off", async () => {
  h.settings = allOffSettings;
  Object.assign(doc, { querySelectorAll: (sel: string) => (sel.includes(":hover") ? [{ dataset: { path: fix.path } }] : []) });
  const c = await panel(main.path, 0, 0, 120, { settings: allOffSettings });
  await pressDelete();
  expect(checks()).toEqual([fix.path]);
  expect(question(c).length).toBe(1);
  expect(removed()).toEqual([]);
});

test("Delete in the pane's worktree label menu still deletes with no question when the setting is off", async () => {
  h.settings = allOffSettings;
  const c = await panel(fix.path, 0, 0, 120, { settings: allOffSettings, worktreeRequest: { path: fix.path, x: 40, y: 60, n: Date.now() } }); // no key press at all
  const item = find(c, (n) => n.attrs.role === "menuitem" && n.textContent.trim().startsWith("Delete"));
  expect(item.length).toBeGreaterThan(0);
  await click(c, item[0]);
  await settle(120);
  expect(question(c).length).toBe(0);
  expect(removed()).toEqual([fix.path]);
});

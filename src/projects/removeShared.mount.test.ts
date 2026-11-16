// PROJ 008 / F21 (job 66, the page's side of job 64's F1): two projects on ONE Git repository. "app" is the main
// checkout, "app-b" a linked worktree of it, and Git lists every worktree to both, so each lists the other's folder and
// the shared "wt3". A shared folder goes only as the removed project's own folder. The real ProjectsPanel on the small
// DOM, backend mocked as in removeNested.mount.test.ts.
import { createElement } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { type FakeDocument, type FakeNode, byLabel, byText, click, find, installDom, mount, settle } from "../tasks/fakeDom";

const h = vi.hoisted(() => ({ unsaved: [] as string[][], closed: [] as unknown[][], extra: {} as Record<string, unknown>, parent: false }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args: Record<string, unknown> = {}) => {
    if (cmd === "get_settings") return Promise.resolve({});
    if (cmd === "workspace_statuses") return Promise.resolve({ list: [] });
    if (cmd === "visibility_get") return Promise.resolve([]);
    // F88-01: "home" (C:/x) stays and its folder lies ABOVE wt9, a worktree only "app" lists
    if (cmd === "project_list" && h.parent)
      return Promise.resolve([
        { id: "p1", name: "app", path: "C:/w/app" },
        { id: "p3", name: "home", path: "C:/x" },
      ]);
    if (cmd === "workspace_scan" && h.parent) return Promise.resolve({ list: args.projectId === "p1" ? [appMain, wt9] : [homeMain], unseen: [] });
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
    if (cmd === "project_remove") return Promise.resolve({ ...(args.projectId === "p1" ? { name: "app", path: "C:/w/app", ended: 1 } : { name: "app-b", path: "C:/w/app-b", ended: 1 }), ...h.extra });
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
const wt9 = { ...base, path: "C:/x/wt9", branch: "nine", head: "d9d9d9d", isMain: false };
const homeMain = { ...base, path: "C:/x", branch: "main", head: "e5e5e5e", isMain: true };
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
  h.extra = {};
  h.parent = false;
});
afterEach(async () => {
  await unmount();
  unmount = async () => {};
});

async function panel(extra: Record<string, unknown> = {}) {
  const { default: ProjectsPanel } = await import("./ProjectsPanel");
  const props = {
    openDirs: ["C:/w/app", "C:/w/app-b", "C:/w/wt3"], sessions, states: {}, unread: new Set<string>(), onUnread: () => {}, settings: {}, onSetting: () => {},
    activeDir: null, onSelect: () => {}, onRemoved: () => {}, onSleep: () => {}, agents: [], launching: false, onLaunch: () => {},
    defaultId: "claude", onSetDefault: () => {}, onChoose: () => {}, page: null, onPage: () => {}, refresh: 0, onIndex: () => {},
    createRequest: 0, deleteRequest: 0, onStartIn: () => {}, nest: true, onNest: () => {}, artifactsOn: false, onArtifacts: () => {},
    onAskUnsaved: async (paths: string[]) => (h.unsaved.push(paths), true),
    onRemovedAll: (paths: string[], staying?: string[]) => void h.closed.push([paths, staying]),
  };
  const m = await mount(createElement(ProjectsPanel, { ...props, ...extra } as never), doc);
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
  // F88-01: the window is handed the members' going folders, each once, not only their own folders
  expect((h.closed[0] as [string[]])[0]).toEqual(["C:/w/app", "C:/w/app-b", "C:/w/wt3"]);
});

// F88-01: a staying project's folder (home, C:/x) lies ABOVE wt9, a worktree only app lists. Removing app hands the window
// app's own folder first, then wt9, so wt9's pane closes as the question says and as the engine ends its terminal.
test("F88-01: removing app hands its own folder, then the worktree under a staying project's folder", async () => {
  h.parent = true;
  const c = await panel({ openDirs: ["C:/w/app", "C:/x/wt9", "C:/x"], sessions: [running(1, "C:/w/app"), running(2, "C:/x/wt9"), running(3, "C:/x")] });
  await click(c, byLabel(c, "button", "Remove app")[0]);
  await settle(20);
  expect(ask(c).textContent).toContain("2 terminals are still running and will be closed.");
  await click(c, byText(c, "button", "Remove app")[0]);
  await settle(40);
  expect(h.unsaved).toEqual([["C:/w/app", "C:/x/wt9"]]);
  expect((h.closed[0] as [string[]])[0]).toEqual(["C:/w/app", "C:/x/wt9"]);
});

test("R71-02: the owner map the sidebar hands to the window maps each project's own folder to its own grid", async () => {
  const seen: [{ id: string; path: string }[], Record<string, string>][] = [];
  await panel({ onIndex: (list: { id: string; path: string }[], owner: Record<string, string>) => void seen.push([list, owner]) });
  const [list, owner] = seen[seen.length - 1];
  const { gridRootsOf } = await import("./worktreeGrid");
  const roots = gridRootsOf(list, owner);
  expect(roots["C:/w/app"]).toBeUndefined();
  expect(roots["C:/w/app-b"]).toBeUndefined();
  expect(["C:/w/app", "C:/w/app-b"]).toContain(roots["C:/w/wt3"]);
});

// R83-04 (reverses R74-02): with the REAL grid map, in both scan orders, the shared "wt3" is listed by app-b, which stays.
// Removing app counts, asks about and closes only app's own folder; wt3's terminal stays open and the question says so.
test.each([
  ["wt3 in app's grid", "C:/w/app"],
  ["wt3 in app-b's grid", "C:/w/app-b"],
])("R83-04: %s: app's Remove question does not count or ask about wt3 and says a shared worktree stays open", async (_, grid) => {
  const { setGridRoots } = await import("../workspaces");
  setGridRoots({ "C:/w/wt3": grid }, ["C:/w/app", "C:/w/app-b"]);
  try {
    const c = await panel();
    await click(c, byLabel(c, "button", "Remove app")[0]);
    await settle(20);
    const text = ask(c).textContent;
    expect(text).toContain("1 terminal is still running and will be closed.");
    expect(text).toContain("are cleared. A worktree that another project in Kolux also lists stays open. The folder and its files stay on disk.");
    await click(c, byText(c, "button", "Remove app")[0]);
    await settle(40);
    expect(h.unsaved).toEqual([["C:/w/app"]]);
  } finally {
    setGridRoots({});
  }
});

// The engine answers `unchecked: true` when Git could not list a project's worktrees, and then leaves those terminals alone.
// R83-01: the list that failed may be a staying project's, so the line names no owner. When the memory number is hidden
// (the bar's "Resource Manager" item unticked), the line says how to bring it back first.
const toEnd = "To end it, click the memory number in the bottom bar";
const toEndHidden = "To end it, right-click the bottom bar, turn on Resource Manager, then click the memory number";
test.each([
  ["unchecked: true", { unchecked: true }, "warn", true, {}],
  ["unchecked: true, memory number hidden", { unchecked: true }, "warn", true, { statusBarHidden: ["memory"] }],
  ["unchecked: false", { unchecked: false }, "ok", false, {}],
  ["no unchecked field (the engine as it is today)", {}, "ok", false, {}],
])("the line after Remove, %s", async (_name, extra, kind, warns, settings) => {
  h.extra = extra;
  const c = await panel({ settings });
  await click(c, byLabel(c, "button", "Remove app")[0]);
  await settle(20);
  await click(c, byText(c, "button", "Remove app")[0]);
  await settle(40);
  const note = find(c, (n) => n.attrs["data-message-note"] !== undefined)[0];
  const text = note.textContent;
  expect(text).toContain("Removed app from Kolux; 1 terminal closed. Its folder stays on disk");
  expect(String(note.attrs.class ?? note.attrs.className)).toBe(`note ${kind}`);
  const hidden = (settings as { statusBarHidden?: string[] }).statusBarHidden?.includes("memory");
  const line = `Git could not list every worktree, so a terminal may still be running. ${hidden ? toEndHidden : toEnd}`;
  if (warns) expect(text).toContain(`Its folder stays on disk. ${line}`);
  else expect(text).not.toContain("Git could not list");
  expect(text).not.toContain("Git did not list its worktrees");
});

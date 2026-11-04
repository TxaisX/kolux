// EDIT-031: deleting a workspace with unsaved editor text asks the same Save / Don't save / Cancel
// question a closing tab gets, and Cancel removes nothing and drops no drafts. The real ProjectsPanel
// and the window's own close guard on the small DOM, with the backend mocked.
import { createElement } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { useCloseGuard } from "../editor/CloseDialog";
import type { GuardPane } from "../editor/closeGuard";
import { type FakeDocument, type FakeNode, byLabel, byText, click, find, installDom, mount, settle } from "../tasks/fakeDom";
import { sameDir } from "../workspaces";
import ProjectsPanel from "./ProjectsPanel";
import CleanupDialog from "./CleanupDialog";
import { PickedBar } from "../shell/ProjectsExtras";
import { namesOf, panesInDirs, unsavedInDirs } from "./wsUnsaved";

const h = vi.hoisted(() => ({ calls: [] as string[], settings: {} as Record<string, unknown>, scan: null as unknown, list: [] as unknown[] }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string) => {
    h.calls.push(cmd);
    if (cmd === "get_settings") return Promise.resolve(h.settings);
    if (cmd === "cleanup_scan") return Promise.resolve(h.scan);
    if (cmd === "workspace_remove_check") return Promise.resolve({ changes: [], locked: null, nested: [], stamp: "s", commits: [] });
    if (cmd === "workspace_statuses") return Promise.resolve({ list: [] });
    if (cmd === "visibility_get") return Promise.resolve([]);
    if (cmd === "project_list") return Promise.resolve([{ id: "p1", name: "app", path: "C:/w/app" }]);
    if (cmd === "project_remove") return Promise.resolve({ name: "app", path: "C:/w/app", ended: 0 });
    if (cmd === "workspace_scan") return Promise.resolve({ list: h.list, unseen: [] });
    if (cmd === "workspaces_place_get") return Promise.resolve({ dir: "", flat: false, used: [], fromEnv: false });
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
const ws = { ...base, path: "C:/w/ws/fix", branch: "fix", head: "c3c3c3c", isMain: false };
const panes: GuardPane[] = [
  { key: 7, kind: "editor", path: "C:/w/ws/fix/a.ts", cwd: "C:/w/ws/fix" },
  { key: 8, kind: "editor", path: "C:/w/ws/fix/b.md", cwd: "C:/w/ws/fix" },
  { key: 9, cwd: "C:/w/ws/fix" },
];
const dirty = { 7: true, 8: false, 9: false };
const props = {
  openDirs: [], sessions: [], states: {}, unread: new Set<string>(), onUnread: () => {}, settings: {}, onSetting: () => {},
  activeDir: null, onSelect: () => {}, onSleep: () => {}, agents: [], launching: false, onLaunch: () => {},
  defaultId: "claude", onSetDefault: () => {}, onChoose: () => {}, page: null, onPage: () => {}, refresh: 0, onIndex: () => {},
  createRequest: 0, deleteRequest: 0, onStartIn: () => {}, nest: true, onNest: () => {}, artifactsOn: false, onArtifacts: () => {},
};
let doc: FakeDocument;
let removed: string[] = [];
let unmount: () => Promise<void> = async () => {};

function Harness() {
  const guard = useCloseGuard({ panes, dirty, close: () => {}, toast: () => {} });
  return createElement(
    "div",
    null,
    guard.dialog,
    createElement(ProjectsPanel, {
      ...props,
      onRemoved: (path: string) => void removed.push(path),
      unsavedIn: (paths: string[]) => namesOf(unsavedInDirs(panes, dirty, paths, sameDir)),
      onAskUnsaved: (paths: string[]) => guard.confirm(panesInDirs(panes, paths, sameDir)),
    } as never),
  );
}

beforeEach(() => {
  const dom = installDom();
  doc = dom.doc;
  Object.assign(dom.win, { setInterval, clearInterval, setTimeout, clearTimeout });
  Object.assign(doc, { querySelectorAll: () => [], querySelector: () => null, visibilityState: "visible", hidden: false });
  h.calls = [];
  h.settings = {};
  h.list = [main, ws];
  h.scan = { projectId: "p1", rows: [{ path: ws.path, branch: "fix", name: null, idleDays: 30, changes: 0, merged: true, unmerged: false, active: false, locked: false, missing: false, quiet: true, preselect: true, keepsBranch: false, note: null }], error: null, timedOut: false, atMs: 1 };
  removed = [];
});
afterEach(async () => {
  await unmount();
  unmount = async () => {};
});

const isDeleteX = (n: FakeNode) => n.localName === "button" && String(n.attrs.title ?? "").startsWith("Delete this workspace");
const delAsk = (c: FakeNode) => byLabel(c, "div", "Delete workspace")[0];
const guardAsk = (c: FakeNode) => byLabel(c, "div", "Save changes before closing?")[0];

test("a dirty tab in the workspace names its file and asks before the delete drops anything", async () => {
  const m = await mount(createElement(Harness), doc);
  unmount = m.unmount;
  const c = m.container as FakeNode;
  await settle(120);
  await click(c, find(c, isDeleteX)[0]);
  await settle(80);
  expect(delAsk(c).textContent).toContain("a.ts"); // the delete question names the file
  expect(delAsk(c).textContent).not.toContain("b.md"); // only the dirty one
  await click(c, byText(delAsk(c), "button", "Delete")[0]);
  await settle(80);
  expect(guardAsk(c)).toBeDefined();
  expect(guardAsk(c).textContent).toContain("a.ts");
  expect(h.calls).not.toContain("workspace_remove");
});

test("Cancel on the unsaved question removes nothing and drops no drafts; Don't save goes on", async () => {
  const m = await mount(createElement(Harness), doc);
  unmount = m.unmount;
  const c = m.container as FakeNode;
  await settle(120);
  await click(c, find(c, isDeleteX)[0]);
  await settle(80);
  await click(c, byText(delAsk(c), "button", "Delete")[0]);
  await settle(80);
  await click(c, byText(guardAsk(c), "button", "Cancel")[0]);
  await settle(80);
  expect(h.calls).not.toContain("workspace_remove");
  expect(h.calls).not.toContain("editor_drafts_drop"); // the drafts survive
  expect(removed).toEqual([]); // its tabs stay
  expect(delAsk(c)).toBeDefined(); // and the workspace is still there to keep or retry
  await click(c, byText(delAsk(c), "button", "Delete")[0]);
  await settle(80);
  await click(c, byText(guardAsk(c), "button", "Don't save")[0]);
  await settle(200);
  expect(h.calls).toContain("workspace_remove");
  expect(h.calls).toContain("editor_drafts_drop"); // only after the explicit choice
  expect(removed).toEqual([ws.path]);
});

// EDIT-031: the multi-select bar's Remove… is a delete path too: it drops drafts, so it asks first.
function PickedHarness() {
  const guard = useCloseGuard({ panes, dirty, close: () => {}, toast: () => {} });
  return createElement(
    "div",
    null,
    guard.dialog,
    createElement(PickedBar, {
      picked: [ws.path],
      find: () => ({ projectId: "p1", name: "fix" }),
      onRemoved: (paths: string[]) => void removed.push(...paths),
      onLeft: () => {},
      onReload: () => {},
      say: () => {},
      unsavedIn: (paths: string[]) => namesOf(unsavedInDirs(panes, dirty, paths, sameDir)),
      onAskUnsaved: (paths: string[]) => guard.confirm(panesInDirs(panes, paths, sameDir)),
    } as never),
  );
}

test("the multi-select Remove names the dirty file and Cancel keeps the workspace and its drafts", async () => {
  const m = await mount(createElement(PickedHarness), doc);
  unmount = m.unmount;
  const c = m.container as FakeNode;
  await settle(40);
  await click(c, byText(c, "button", "Remove…")[0]);
  await settle(80);
  expect(find(c, (n) => n.textContent.includes("a.ts")).length).toBeGreaterThan(0); // the question names the file
  await click(c, byText(c, "button", "Remove it")[0]);
  await settle(80);
  expect(guardAsk(c)).toBeDefined();
  await click(c, byText(guardAsk(c), "button", "Cancel")[0]);
  await settle(80);
  expect(h.calls).not.toContain("workspace_remove");
  expect(h.calls).not.toContain("editor_drafts_drop"); // the drafts survive
  expect(removed).toEqual([]); // the workspace stays
});

// EDIT-031: Cleanup's Remove for good is the same delete path.
function CleanupHarness() {
  const guard = useCloseGuard({ panes, dirty, close: () => {}, toast: () => {} });
  return createElement(
    "div",
    null,
    guard.dialog,
    createElement(CleanupDialog, {
      project: { id: "p1", name: "app" },
      onClose: () => {},
      onRemoved: (paths: string[]) => void removed.push(...paths),
      onKept: () => {},
      parentOf: () => null,
      unsavedIn: (paths: string[]) => namesOf(unsavedInDirs(panes, dirty, paths, sameDir)),
      onAskUnsaved: (paths: string[]) => guard.confirm(panesInDirs(panes, paths, sameDir)),
    } as never),
  );
}

test("the Cleanup dialog names the dirty file and Cancel leaves every workspace and draft", async () => {
  const m = await mount(createElement(CleanupHarness), doc);
  unmount = m.unmount;
  const c = m.container as FakeNode;
  await settle(120);
  await click(c, byText(c, "button", "Remove 1 ticked")[0]);
  await settle(40);
  expect(find(c, (n) => n.textContent.includes("a.ts")).length).toBeGreaterThan(0); // the question names the file
  await click(c, byText(c, "button", "Remove for good")[0]);
  await settle(80);
  expect(guardAsk(c)).toBeDefined();
  await click(c, byText(guardAsk(c), "button", "Cancel")[0]);
  await settle(80);
  expect(h.calls).not.toContain("cleanup_remove");
  expect(h.calls).not.toContain("workspace_remove");
  expect(removed).toEqual([]); // nothing was removed
});

// B1: "Remove project" closes every pane under the project's folder, so its editor tabs are asked about too.
const nested = { ...base, path: "C:/w/app/ws/nested", branch: "nested", head: "d4d4d4d", isMain: false };
// A worktree hidden by hand is not in the sidebar's list, but the removal closes its panes all the same.
const hiddenWt = { ...base, path: "C:/w/app/ws/hidden", branch: "hidden", head: "e5e5e5e", isMain: false, hidden: true };
const projectPanes: GuardPane[] = [
  { key: 11, kind: "editor", path: "C:/w/app/README.md", cwd: "C:/w/app" }, // the project's own folder
  { key: 12, kind: "editor", path: "C:/w/app/ws/nested/c.ts", cwd: "C:/w/app/ws/nested" }, // a workspace inside it
  { key: 13, kind: "editor", path: "C:/w/ws/fix/d.ts", cwd: "C:/w/ws/fix" }, // outside it: stays open
  { key: 14, kind: "editor", path: "C:/w/app/ws/hidden/e.ts", cwd: "C:/w/app/ws/hidden" }, // a hidden workspace inside it
];
const projectDirty = { 11: true, 12: true, 13: true, 14: true };

function ProjectHarness() {
  const guard = useCloseGuard({ panes: projectPanes, dirty: projectDirty, close: () => {}, toast: () => {} });
  return createElement(
    "div",
    null,
    guard.dialog,
    createElement(ProjectsPanel, {
      ...props,
      openDirs: projectPanes.flatMap((p) => (p.cwd ? [p.cwd] : [])), // every pane's folder, as App passes it
      onRemoved: (path: string) => void removed.push(path),
      unsavedIn: (paths: string[]) => namesOf(unsavedInDirs(projectPanes, projectDirty, paths, sameDir)),
      onAskUnsaved: (paths: string[]) => guard.confirm(panesInDirs(projectPanes, paths, sameDir)),
    } as never),
  );
}

const projAsk = (c: FakeNode) => byLabel(c, "div", "Remove project")[0];
const projX = (c: FakeNode) => find(c, (n) => n.localName === "button" && n.attrs["data-proj-x"] !== undefined)[0];

test("Remove project asks about every editor tab it closes, hidden workspaces included, and Cancel removes nothing", async () => {
  h.list = [main, ws, nested, hiddenWt];
  const m = await mount(createElement(ProjectHarness), doc);
  unmount = m.unmount;
  const c = m.container as FakeNode;
  await settle(120);
  await click(c, projX(c));
  await settle(80);
  await click(c, byText(projAsk(c), "button", "Remove app")[0]);
  await settle(80);
  expect(guardAsk(c)).toBeDefined(); // the unsaved question comes before anything is removed
  expect(guardAsk(c).textContent).toContain("README.md"); // the project's own folder is asked about
  expect(guardAsk(c).textContent).toContain("c.ts"); // and the workspaces inside it, which close too
  expect(guardAsk(c).textContent).toContain("e.ts"); // a hidden workspace is not listed, but its tabs close too
  expect(guardAsk(c).textContent).not.toContain("d.ts"); // one outside it stays open, so it is not asked about
  expect(projAsk(c).textContent).toContain("editor tabs close"); // and the question says the tabs close too
  expect(h.calls).not.toContain("project_remove");
  await click(c, byText(guardAsk(c), "button", "Cancel")[0]);
  await settle(80);
  expect(h.calls).not.toContain("project_remove");
  expect(h.calls).not.toContain("editor_drafts_drop");
  expect(removed).toEqual([]); // its tabs stay
  await click(c, byText(projAsk(c), "button", "Remove app")[0]);
  await settle(80);
  await click(c, byText(guardAsk(c), "button", "Don't save")[0]);
  await settle(200);
  expect(h.calls).toContain("project_remove"); // only after the explicit choice
  expect(removed).toEqual(["C:/w/app"]);
});

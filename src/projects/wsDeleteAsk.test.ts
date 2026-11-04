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

const h = vi.hoisted(() => ({ calls: [] as string[], settings: {} as Record<string, unknown>, scan: null as unknown }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string) => {
    h.calls.push(cmd);
    if (cmd === "get_settings") return Promise.resolve(h.settings);
    if (cmd === "cleanup_scan") return Promise.resolve(h.scan);
    if (cmd === "workspace_remove_check") return Promise.resolve({ changes: [], locked: null, nested: [], stamp: "s", commits: [] });
    if (cmd === "workspace_statuses") return Promise.resolve({ list: [] });
    if (cmd === "visibility_get") return Promise.resolve([]);
    if (cmd === "project_list") return Promise.resolve([{ id: "p1", name: "app", path: "C:/w/app" }]);
    if (cmd === "workspace_scan") return Promise.resolve({ list: [main, ws], unseen: [] });
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

// C05-R1-01: the batch question names what the click takes: the folders, the files Git ignores, the branch.
function BatchHarness() {
  return createElement(PickedBar, {
    picked: [ws.path, "C:/w/ws/two"],
    find: (p: string) => ({ projectId: "p1", name: p.endsWith("fix") ? "fix" : "two" }),
    onRemoved: () => {},
    onLeft: () => {},
    onReload: () => {},
    say: () => {},
    unsavedIn: () => [],
    onAskUnsaved: async () => true,
  } as never);
}

test("the multi-select question names the folders, the Git-ignored files and the branch outcome", async () => {
  const m = await mount(createElement(BatchHarness), doc);
  unmount = m.unmount;
  const c = m.container as FakeNode;
  await settle(40);
  await click(c, byText(c, "button", "Remove…")[0]);
  await settle(80);
  expect(byText(c, "h2", "Remove 2 workspaces?")[0], "the batch question is shown").toBeDefined();
  const text = (c.textContent ?? "").replace(/\s+/g, " ");
  expect(text, "says the folders go").toMatch(/folder/i);
  expect(text, "says files Git ignores go").toMatch(/ignor/i);
  expect(text, "says what happens to the branch").toMatch(/branch/i);
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

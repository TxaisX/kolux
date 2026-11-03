// T-614 (F04-projects-scm.2): a delete of several workspaces tells the window once, with every path,
// so its tabs close in one go and the shown workspace gives way to one that is not going too. The
// real ProjectsPanel, multi-select bar and cleanup dialog on the small DOM, with the backend mocked.
import { createElement } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { type FakeDocument, type FakeNode, byText, click, find, fire, installDom, mount, settle } from "../tasks/fakeDom";

const h = vi.hoisted(() => ({ wt: [] as unknown[], scan: null as unknown }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args: Record<string, unknown> = {}) => {
    if (cmd === "workspace_remove_check") return Promise.resolve({ changes: [], locked: null, nested: [], stamp: `s:${String(args.path)}`, commits: [] });
    if (cmd === "cleanup_scan") return Promise.resolve(h.scan);
    if (cmd === "cleanup_remove") return Promise.resolve({ removed: args.paths, left: [], kept: [] });
    if (cmd === "get_settings") return Promise.resolve({});
    if (cmd === "workspace_statuses") return Promise.resolve({ list: [] });
    if (cmd === "visibility_get") return Promise.resolve([]);
    if (cmd === "project_list") return Promise.resolve([{ id: "p1", name: "app", path: "C:/w/app" }]);
    if (cmd === "workspace_scan") return Promise.resolve({ list: h.wt, unseen: [] });
    if (cmd === "workspaces_place_get") return Promise.resolve({ dir: "", flat: false, used: [], fromEnv: false });
    if (cmd === "scm_prs_poll") return Promise.resolve({ prs: [], limitedUntil: null });
    if (cmd === "setup_suggestion") return Promise.resolve({ kind: "none" });
    if (cmd === "groups_get" || cmd === "activity_get" || cmd === "project_icons_list") return Promise.resolve({});
    if (cmd === "skills_scan") return Promise.resolve({ skills: [] }); // the sidebar checklist reads it
    return Promise.resolve(null);
  },
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: () => Promise.resolve(() => {}) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: () => Promise.resolve(null) }));

const base = { hidden: false, number: null, comment: "" };
const main = { ...base, path: "C:/w/app", branch: "main", head: "abc1234", isMain: true };
const parent = { ...base, path: "C:/w/ws/fix", branch: "fix", head: "c3c3c3c", isMain: false };
const kid = { ...base, path: "C:/w/ws/fix-tests", branch: "fix-tests", head: "d4d4d4d", isMain: false, parent: parent.path };
const row = (w: { path: string; branch: string }) => ({ path: w.path, branch: w.branch, name: null, idleDays: 30, changes: 0, merged: true, unmerged: false, active: false, locked: false, missing: false, quiet: true, preselect: true, keepsBranch: false, note: null });

let doc: FakeDocument;
let told: [string, unknown][] = [];
let unmount: () => Promise<void> = async () => {};

beforeEach(() => {
  const dom = installDom();
  doc = dom.doc;
  Object.assign(dom.win, { setInterval, clearInterval, setTimeout, clearTimeout });
  Object.assign(doc, { querySelectorAll: () => [], querySelector: () => null, visibilityState: "visible", hidden: false });
  h.wt = [main, parent, kid];
  h.scan = { projectId: "p1", rows: [row(kid), row(parent)], error: null, timedOut: false, atMs: 1 };
  told = [];
});
afterEach(async () => {
  await unmount();
  unmount = async () => {};
});

async function panel() {
  const { default: ProjectsPanel } = await import("./ProjectsPanel");
  const props = {
    openDirs: ["C:/w/app"], sessions: [], states: {}, unread: new Set<string>(), onUnread: () => {}, settings: {}, onSetting: () => {},
    activeDir: "C:/w/app", onSelect: () => {}, onSleep: () => {}, agents: [], launching: false, onLaunch: () => {},
    defaultId: "claude", onSetDefault: () => {}, onChoose: () => {}, page: null, onPage: () => {}, refresh: 0, onIndex: () => {},
    createRequest: 0, deleteRequest: 0, onStartIn: () => {}, nest: true, onNest: () => {}, artifactsOn: false, onArtifacts: () => {},
    onRemoved: (p: string) => void told.push(["one", p]),
    onRemovedAll: (ps: string[]) => void told.push(["all", ps]),
  };
  const m = await mount(createElement(ProjectsPanel, props as never), doc);
  unmount = m.unmount;
  await settle(120);
  return m.container as FakeNode;
}
const cls = (n: FakeNode) => String(n.attrs.className ?? n.attrs.class ?? "");

test("Delete all on a parent with a child tells the window once, children first", async () => {
  const c = await panel();
  const sess = find(c, (n) => n.attrs["data-path"] === parent.path)[0].childNodes.find((n) => cls(n).includes("sess"))!;
  await fire(c, "contextmenu", sess, { clientX: 5, clientY: 5, altKey: false });
  await settle(60);
  await click(c, byText(c, "button", "Delete")[0]);
  await settle(60);
  await click(c, byText(c, "button", "Delete all")[0]);
  await settle(120);
  expect(told).toEqual([["all", [kid.path, parent.path]]]);
});

test("the cleanup dialog's removal tells the window once", async () => {
  const c = await panel();
  await click(c, find(c, (n) => n.localName === "button" && String(n.attrs.title ?? "").startsWith("Project settings"))[0]);
  await settle(60);
  await click(c, byText(c, "button", "Clean up workspaces…")[0]);
  await settle(120);
  await click(c, byText(c, "button", "Remove 2 ticked")[0]);
  await settle(60);
  await click(c, byText(c, "button", "Remove for good")[0]);
  await settle(200);
  expect(told).toEqual([["all", [kid.path, parent.path]]]);
});

test("the multi-select bar tells the window once", async () => {
  const { PickedBar } = await import("../shell/ProjectsExtras");
  const calls: unknown[][] = [];
  const m = await mount(
    createElement(PickedBar, { picked: [parent.path, kid.path], find: () => ({ projectId: "p1", name: "w" }), onRemoved: (...a: unknown[]) => void calls.push(a), onLeft: () => {}, onReload: () => {}, say: () => {} }),
    doc,
  );
  unmount = m.unmount;
  const c = m.container as FakeNode;
  await click(c, byText(c, "button", "Remove…")[0]);
  await settle(60);
  await click(c, byText(c, "button", "Remove 2")[0]);
  await settle(60);
  expect(calls).toEqual([[[parent.path, kid.path]]]);
});

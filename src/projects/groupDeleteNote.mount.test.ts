// Job 24 item 3 on the real ProjectsPanel (harness as in groupDeleteCloses.mount.test.ts): with "Also remove its
// projects" ticked, the "Delete group" question counts the running sessions of every project that goes with the
// group, sub-groups included, the same list deleteGroup asks about and closes (projectsInGroup).
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, test, vi } from "vitest";
import { type FakeDocument, type FakeNode, byLabel, click, find, installDom, mount, settle } from "../test/fakeDom";
import { projectsInGroup } from "./groupMembers";

const h = vi.hoisted(() => ({ sessions: [] as { cwd: string; running: boolean }[], closed: [] as string[][] }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args: Record<string, unknown> = {}) => {
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
    if (cmd === "workspace_scan") return Promise.resolve({ list: args.projectId === "p1" ? [main] : args.projectId === "p2" ? [lib] : [other], unseen: [] });
    if (cmd === "workspaces_place_get") return Promise.resolve({ dir: "", flat: false, used: [], fromEnv: false });
    if (cmd === "setup_suggestion") return Promise.resolve({ kind: "none" });
    if (cmd === "groups_get") return Promise.resolve({ groups, members: { p1: "g1", p2: "g2" }, rev: 1 });
    if (cmd === "activity_get" || cmd === "project_icons_list") return Promise.resolve({});
    if (cmd === "skills_scan") return Promise.resolve({ skills: [] });
    return Promise.resolve(null);
  },
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: () => Promise.resolve(() => {}) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: () => Promise.resolve(null) }));

const base = { hidden: false, number: null, comment: "", isMain: true };
const main = { ...base, path: "C:/w/app", branch: "main", head: "abc1234" };
const lib = { ...base, path: "C:/w/lib", branch: "main", head: "bcd2345" };
const other = { ...base, path: "C:/w/other", branch: "main", head: "cde3456" };
let doc: FakeDocument;
let unmount: () => Promise<void> = async () => {};

beforeEach(() => {
  const dom = installDom();
  doc = dom.doc;
  Object.assign(dom.win, { setInterval, clearInterval, setTimeout, clearTimeout });
  Object.assign(doc, { querySelectorAll: () => [], querySelector: () => null, visibilityState: "visible", hidden: false });
  h.sessions = [];
  h.closed = [];
});
afterEach(async () => {
  await unmount();
  unmount = async () => {};
});

async function panel() {
  const { default: ProjectsPanel } = await import("./ProjectsPanel");
  const props = {
    openDirs: ["C:/w/app", "C:/w/lib", "C:/w/other"], sessions: h.sessions, states: {}, unread: new Set<string>(), onUnread: () => {}, settings: {}, onSetting: () => {},
    activeDir: null, onSelect: () => {}, onRemoved: () => {}, onSleep: () => {}, agents: [], launching: false, onLaunch: () => {},
    defaultId: "claude", onSetDefault: () => {}, onChoose: () => {}, page: null, onPage: () => {}, refresh: 0, onIndex: () => {},
    createRequest: 0, deleteRequest: 0, onStartIn: () => {}, nest: true, onNest: () => {}, artifactsOn: false, onArtifacts: () => {},
    onAskUnsaved: async () => true,
    onRemovedAll: (paths: string[]) => void h.closed.push(paths),
  };
  const m = await mount(createElement(ProjectsPanel, props as never), doc);
  unmount = m.unmount;
  await settle(120);
  return m.container as FakeNode;
}
const question = (c: FakeNode) => find(c, (n) => n.attrs.role === "alertdialog" && n.textContent.includes("Delete Clients?"))[0];
async function openQuestion(c: FakeNode) {
  await click(c, byLabel(c, "button", "Delete group Clients")[0]);
  await settle(20);
  const box = byLabel(c, "input", "also remove the projects")[0];
  Object.assign(box, { checked: true }); // the browser ticks the box, then React reads it in the click
  await click(c, box);
  await settle(20);
  return question(c).textContent;
}

test("a running session in a sub-group's project is counted", async () => {
  h.sessions = [{ cwd: "C:/w/lib", running: true }];
  const c = await panel();
  expect(await openQuestion(c)).toContain("1 terminal is still running and will be closed.");
});

test("the group's own and its sub-group's sessions both count; a project outside the group does not", async () => {
  h.sessions = [{ cwd: "C:/w/app", running: true }, { cwd: "C:/w/lib", running: true }, { cwd: "C:/w/other", running: true }];
  const c = await panel();
  expect(await openQuestion(c)).toContain("2 terminals are still running and will be closed.");
});

describe("projectsInGroup", () => {
  const groups = {
    groups: [
      { id: "g1", name: "A", parent: null },
      { id: "g2", name: "B", parent: "g1" },
      { id: "g3", name: "C", parent: "g2" },
      { id: "g4", name: "D", parent: null },
    ],
    members: { p1: "g1", p2: "g2", p3: "g3", p4: "g4" },
    rev: 1,
  };
  it("takes the group's projects and every sub-group's, at any depth", () => {
    expect(projectsInGroup(groups, "g1").sort()).toEqual(["p1", "p2", "p3"]);
    expect(projectsInGroup(groups, "g2").sort()).toEqual(["p2", "p3"]);
    expect(projectsInGroup(groups, "g4")).toEqual(["p4"]);
  });
});

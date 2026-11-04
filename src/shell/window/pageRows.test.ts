// C02-R5-01: the sidebar's Tasks, Automations and Model routing rows set only `page`, but those pages
// draw only on the Terminals screen, so from the other seven screens the click changed nothing while
// the row marked itself current. The rows now bring Terminals up, and the toggle and the current mark
// are guarded by the screen so a stale page cannot close the page the user asked for.
import { createElement } from "react";
import { afterEach, expect, test, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string) => {
    if (cmd === "get_settings") return Promise.resolve({});
    if (cmd === "project_list") return Promise.resolve([]);
    if (cmd === "workspace_scan") return Promise.resolve({ list: [], unseen: [] });
    if (cmd === "workspace_statuses") return Promise.resolve({ list: [] });
    if (cmd === "visibility_get") return Promise.resolve([]);
    if (cmd === "groups_get") return Promise.resolve({ groups: [], members: {}, rev: 1 });
    if (cmd === "activity_get" || cmd === "project_icons_list") return Promise.resolve({});
    if (cmd === "skills_scan") return Promise.resolve({ skills: [] });
    if (cmd === "setup_suggestion") return Promise.resolve({ kind: "none" });
    if (cmd === "workspaces_place_get") return Promise.resolve({ dir: "", flat: false, used: [], fromEnv: false });
    return Promise.resolve(null);
  },
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: () => Promise.resolve(() => {}) }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ isMaximized: () => Promise.resolve(false), onResized: () => Promise.resolve(() => {}) }) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: () => Promise.resolve(null) }));

import { byLabel, byText, click, installDom, mount, settle, type FakeNode } from "../../tasks/fakeDom";
import type { WindowBag } from "../windowBag";
import { WindowStoreProvider } from "./store";

let unmount: () => Promise<void> = async () => {};
afterEach(async () => {
  await unmount();
  unmount = async () => {};
});

async function sidebar(screen: string, start: string | null) {
  const { doc, win } = installDom();
  Object.assign(win, { setInterval, clearInterval, setTimeout, clearTimeout });
  Object.assign(doc, { querySelectorAll: () => [], querySelector: () => null, visibilityState: "visible", hidden: false });
  let page = start;
  const screens: string[] = [];
  const noop = () => {};
  const bag = {
    screen, sidebarOpen: true, reveal: 0, openDirs: [], sources: [], rowStates: {}, unreadDirs: new Set(), markDir: noop,
    settings: {}, saveSetting: noop, activeDir: null, select: noop, removed: noop, removedAll: noop, agents: [],
    defaultId: "claude", setDefault: noop, launching: false, launch: noop, addChooser: noop, newTab: noop, allAgents: [],
    agentPass: () => {}, refreshAgents: noop, page, refresh: 0, createRequest: 0, createName: "", deleteRequest: 0,
    renameRequest: 0, setRenameRequest: noop, startIn: noop, projectAdded: noop, standIns: [], startSetup: noop,
    setProjects: noop, setOwner: noop, setNames: noop, leftWidth: 289, setDragLeft: noop, agentsScreen: false, groups: [],
    selected: null, classic: false, chipFor: noop, ringOf: noop, footer: null, setAgentSel: noop, setFocused: noop,
    addPreset: noop, closePane: noop, workerNames: {}, ptys: { current: {} }, wsUnsaved: () => [], askWsUnsaved: async () => true,
    setPage: (v: string | null | ((p: string | null) => string | null)) => { page = typeof v === "function" ? v(page) : v; },
    setScreen: (s: string) => void screens.push(s),
  } as unknown as WindowBag;
  const { default: WindowSidebar } = await import("./Sidebar");
  const m = await mount(createElement(WindowStoreProvider, { store: bag, children: createElement(WindowSidebar) }), doc);
  unmount = m.unmount;
  await settle(200);
  const c = m.container as FakeNode;
  return {
    c,
    row: (label: string) => byText(c, "button", label)[0],
    routing: () => byLabel(c, "button", "Model routing")[0] ?? null,
    screens,
    pageNow: () => page,
  };
}

test("Tasks from Board brings Terminals up with the Tasks page", async () => {
  const s = await sidebar("board", null);
  await click(s.c, s.row("Tasks"));
  await settle(40);
  expect(s.screens, "the click asks for the Terminals screen").toContain("terminals");
  expect(s.pageNow()).toBe("tasks");
}, 20000);

test("Tasks from Artifacts with a stale page still opens Tasks", async () => {
  const s = await sidebar("artifacts", "tasks");
  await click(s.c, s.row("Tasks"));
  await settle(40);
  expect(s.screens).toContain("terminals");
  expect(s.pageNow(), "keeps the page open, not toggling a page the user cannot see").toBe("tasks");
}, 20000);

test("Model routing from Skills brings Terminals up with the routing page", async () => {
  const s = await sidebar("skills", null);
  await click(s.c, s.routing()!);
  await settle(40);
  expect(s.screens).toContain("terminals");
  expect(s.pageNow()).toBe("routing");
}, 20000);

test("Automations from Inbox brings Terminals up with the Automations page", async () => {
  const s = await sidebar("inbox", null);
  await click(s.c, s.row("Automations"));
  await settle(40);
  expect(s.screens).toContain("terminals");
  expect(s.pageNow()).toBe("automations");
}, 20000);

test("on Terminals the row still toggles the page shut", async () => {
  const s = await sidebar("terminals", "tasks");
  await click(s.c, s.row("Tasks"));
  await settle(40);
  expect(s.pageNow()).toBe(null);
}, 20000);

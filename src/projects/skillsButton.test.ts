// T-766: View > Appearance's "Show Skills Button" is the switch for SKILL-018's sidebar row. The row is
// absent on a fresh install (the setting is off) and appears as soon as the saved setting is on.
import { createElement } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { type FakeDocument, type FakeNode, find, installDom, mount, settle } from "../tasks/fakeDom";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string) => {
    if (cmd === "project_list") return Promise.resolve([{ id: "p1", name: "app", path: "C:/w/app" }]);
    if (cmd === "workspace_scan") return Promise.resolve({ list: [], unseen: [] });
    if (cmd === "workspaces_place_get") return Promise.resolve({ dir: "", flat: false, used: [], fromEnv: false });
    if (cmd === "setup_suggestion") return Promise.resolve({ kind: "none" });
    if (cmd === "groups_get" || cmd === "activity_get" || cmd === "project_icons_list") return Promise.resolve({});
    if (cmd === "skills_scan") return Promise.resolve({ skills: [] });
    return Promise.resolve(null);
  },
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: () => Promise.resolve(() => {}) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: () => Promise.resolve(null) }));

let doc: FakeDocument;
let unmount: () => Promise<void> = async () => {};
beforeEach(() => {
  const dom = installDom();
  doc = dom.doc;
  Object.assign(dom.win, { setInterval, clearInterval, setTimeout, clearTimeout });
  Object.assign(doc, { querySelectorAll: () => [], querySelector: () => null, visibilityState: "visible", hidden: false });
});
afterEach(async () => {
  await unmount();
  unmount = async () => {};
});

const props = (settings: Record<string, unknown>) => ({
  openDirs: ["C:/w/app"], sessions: [], states: {}, unread: new Set<string>(), onUnread: () => {}, settings, onSetting: () => {},
  activeDir: "C:/w/app", onSelect: () => {}, onRemoved: () => {}, onSleep: () => {}, agents: [], launching: false, onLaunch: () => {},
  defaultId: "claude", onSetDefault: () => {}, onChoose: () => {}, page: null, onPage: () => {}, refresh: 0, onIndex: () => {},
  createRequest: 0, deleteRequest: 0, onStartIn: () => {}, nest: true, onNest: () => {}, artifactsOn: false, onArtifacts: () => {},
});
const skillsRow = (c: FakeNode) => find(c, (n) => n.localName === "button" && n.textContent.trim() === "Skills");

test("T-766: the sidebar Skills button follows the setting the View menu flips", async () => {
  const { default: ProjectsPanel } = await import("./ProjectsPanel");
  const off = await mount(createElement(ProjectsPanel, props({}) as never), doc);
  unmount = off.unmount;
  await settle(120);
  expect(skillsRow(off.container as FakeNode)).toHaveLength(0);
  await unmount();
  const on = await mount(createElement(ProjectsPanel, props({ skillsButton: true }) as never), doc);
  unmount = on.unmount;
  await settle(120);
  expect(skillsRow(on.container as FakeNode)).toHaveLength(1);
  expect(skillsRow(on.container as FakeNode)[0].hasAttribute("aria-current")).toBe(false);
});

// T-764 / T-744 (#195 b): the control for pollWarning.test.ts. With no error showing in the Projects panel, a failing
// workspace scan DOES show its warning (so the "(a) the error stays" result is not just a dead warning path).
import { createElement } from "react";
import { expect, test, vi } from "vitest";
import { find, installDom, mount, until } from "../tasks/fakeDom";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string) => {
    if (cmd === "git_version") return Promise.resolve("git version 2.50.0");
    if (cmd === "workspace_scan") return Promise.reject(new Error("the folder is gone"));
    if (cmd === "get_settings") return Promise.resolve({});
    if (cmd === "workspace_statuses") return Promise.resolve({ list: [] });
    if (cmd === "visibility_get") return Promise.resolve([]);
    if (cmd === "project_list") return Promise.resolve([{ id: "p1", name: "app", path: "C:/w/app" }]);
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

test("T-744: with no error showing, a failed workspace scan shows its warning", async () => {
  const dom = installDom();
  const doc = dom.doc;
  Object.assign(dom.win, { setInterval, clearInterval, setTimeout, clearTimeout, addEventListener() {} });
  Object.assign(doc, { querySelectorAll: () => [], querySelector: () => null, visibilityState: "visible", hidden: false });
  const { default: ProjectsPanel } = await import("./ProjectsPanel");
  const props = {
    openDirs: ["C:/w/app"], sessions: [], states: {}, unread: new Set<string>(), onUnread: () => {}, settings: {}, onSetting: () => {},
    activeDir: "C:/w/app", onSelect: () => {}, onSleep: () => {}, agents: [], launching: false, onLaunch: () => {},
    defaultId: "claude", onSetDefault: () => {}, onChoose: () => {}, page: null, onPage: () => {}, refresh: 0, onIndex: () => {},
    createRequest: 0, deleteRequest: 0, onStartIn: () => {}, nest: true, onNest: () => {}, artifactsOn: false, onArtifacts: () => {}, onRemoved: () => {},
  };
  const { container, unmount } = await mount(createElement(ProjectsPanel, props as never), doc);
  const note = () => find(container, (n) => n.attrs["data-message-note"] !== undefined)[0];
  await until(() => !!note()?.textContent.includes("Could not list the workspaces of app"), "the scan warning");
  expect(note().textContent).toContain("the folder is gone");
  await unmount();
});

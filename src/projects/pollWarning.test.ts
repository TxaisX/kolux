// T-744 (DT-C180, empty-error.md F3): the workspace scan warning (the same sweep the 5 s poll and a status refresh run; this test drives the refresh) does not cover
// an error the panel is showing; before, it replaced it, so the error vanished within seconds.
import { createElement } from "react";
import { expect, test, vi } from "vitest";
import { find, installDom, mount, settle, until } from "../tasks/fakeDom";
import { WORKSPACE_STATUS } from "./statusRefresh";

const h = vi.hoisted(() => ({ wt: [] as unknown[], scanFails: false }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string) => {
    if (cmd === "git_version") return Promise.reject(new Error("git was not found"));
    if (cmd === "workspace_scan" && h.scanFails) return Promise.reject(new Error("the folder is gone"));
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

test("T-744: a failed workspace scan leaves the panel's error in place", async () => {
  const dom = installDom();
  const doc = dom.doc;
  const heard: (() => void)[] = [];
  Object.assign(dom.win, { setInterval, clearInterval, setTimeout, clearTimeout, addEventListener: (type: string, fn: () => void) => type === WORKSPACE_STATUS && heard.push(fn) });
  Object.assign(doc, { querySelectorAll: () => [], querySelector: () => null, visibilityState: "visible", hidden: false });
  h.wt = [{ hidden: false, number: null, comment: "", path: "C:/w/app", branch: "main", head: "abc1234", isMain: true }];
  const { default: ProjectsPanel } = await import("./ProjectsPanel");
  const props = {
    openDirs: ["C:/w/app"], sessions: [], states: {}, unread: new Set<string>(), onUnread: () => {}, settings: {}, onSetting: () => {},
    activeDir: "C:/w/app", onSelect: () => {}, onSleep: () => {}, agents: [], launching: false, onLaunch: () => {},
    defaultId: "claude", onSetDefault: () => {}, onChoose: () => {}, page: null, onPage: () => {}, refresh: 0, onIndex: () => {},
    createRequest: 0, deleteRequest: 0, onStartIn: () => {}, nest: true, onNest: () => {}, artifactsOn: false, onArtifacts: () => {}, onRemoved: () => {},
  };
  const { container, unmount } = await mount(createElement(ProjectsPanel, props as never), doc);
  const note = () => find(container, (n) => n.attrs["data-message-note"] !== undefined)[0];
  await until(() => !!note()?.textContent.includes("git was not found"), "the error");
  h.scanFails = true;
  expect(heard.length).toBeGreaterThan(0);
  heard.forEach((f) => f());
  await settle(200);
  expect(note().textContent, "the error stays; the warning does not replace it").toContain("git was not found");
  await unmount();
});

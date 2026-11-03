// SET-032 acceptance (page half): the real ProjectsPanel on the small DOM. Browse hands the chosen folder to workspaces_place_set;
// where the next worktree then lands is proven in src-tauri/tests/cards_17.rs (set032_box1/box2) on the real Rust code.
// MIRROR: the stand-in workspaces_place_set only echoes the saved folder back; the Rust half mirrors its two settings writes (projects.rs:2359).
import { createElement } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { click, type FakeDocument, type FakeNode, find, installDom, mount, settle, until } from "../../tasks/fakeDom";

const h = vi.hoisted(() => ({
  pick: null as string | null,
  place: { dir: "", flat: false, used: [] as string[], fromEnv: false },
  calls: [] as { cmd: string; args: Record<string, unknown> }[],
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args: Record<string, unknown> = {}) => {
    h.calls.push({ cmd, args });
    if (cmd === "project_list") return Promise.resolve([{ id: "p1", name: "app", path: "C:/w/app" }]);
    if (cmd === "workspace_scan") return Promise.resolve({ list: [], unseen: [] });
    if (cmd === "workspaces_place_get") return Promise.resolve({ ...h.place });
    if (cmd === "workspaces_place_set") {
      const a = args as { dir: string; flat: boolean };
      h.place = { dir: a.dir, flat: a.flat, used: [a.dir], fromEnv: false };
      return Promise.resolve({ ...h.place });
    }
    if (cmd === "visibility_get") return Promise.resolve([]);
    if (cmd === "setup_suggestion") return Promise.resolve({ kind: "none" });
    if (cmd === "groups_get" || cmd === "activity_get" || cmd === "project_icons_list") return Promise.resolve({});
    if (cmd === "skills_scan") return Promise.resolve({ skills: [] }); // the sidebar checklist reads it
    return Promise.resolve(null);
  },
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: () => Promise.resolve(() => {}) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: () => Promise.resolve(h.pick) }));

let doc: FakeDocument;
let unmount: () => Promise<void> = async () => {};
beforeEach(() => {
  const dom = installDom();
  doc = dom.doc;
  Object.assign(dom.win, { setInterval, clearInterval, setTimeout, clearTimeout });
  Object.assign(doc, { querySelectorAll: () => [], querySelector: () => null, visibilityState: "visible", hidden: false });
  h.pick = null;
  h.place = { dir: "", flat: false, used: [], fromEnv: false };
  h.calls = [];
});
afterEach(async () => {
  await unmount();
  unmount = async () => {};
});

async function panel() {
  const { default: ProjectsPanel } = await import("../ProjectsPanel");
  const props = {
    openDirs: [], sessions: [], states: {}, unread: new Set<string>(), onUnread: () => {}, settings: {}, onSetting: () => {},
    activeDir: null, onSelect: () => {}, onRemoved: () => {}, onSleep: () => {}, agents: [], launching: false, onLaunch: () => {},
    defaultId: "claude", onSetDefault: () => {}, onChoose: () => {}, page: null, onPage: () => {}, refresh: 0, onIndex: () => {},
    createRequest: 0, deleteRequest: 0, onStartIn: () => {}, nest: true, onNest: () => {}, artifactsOn: false, onArtifacts: () => {},
  };
  const m = await mount(createElement(ProjectsPanel, props as never), doc);
  unmount = m.unmount;
  await settle(120);
  return m.container as FakeNode;
}
const addButton = (c: FakeNode) => find(c, (n) => n.localName === "button" && String(n.attrs.title ?? "").startsWith("Add project:"))[0];
const byPath = (c: FakeNode) => find(c, (n) => n.localName === "button" && n.attrs["data-add-by-path"] !== undefined)[0];
/** The by-path form (with the workspaces folder) opens from the Add project dialog's link; the footer gear is Settings now. */
const openByPath = async (c: FakeNode) => {
  await click(c, addButton(c));
  await click(c, byPath(c));
};
const field = (c: FakeNode) => find(c, (n) => n.localName === "input" && n.attrs["aria-label"] === "workspaces folder")[0];
const valueOf = (n: FakeNode) => String((n as unknown as { value?: unknown }).value ?? n.attrs.value ?? "");

test("box 1: Browse to a folder saves it with the nested layout and the field shows it", async () => {
  const c = await panel();
  await openByPath(c);
  await until(() => field(c) !== undefined, "the workspaces folder field");
  h.pick = "D:/wt";
  const browse = find(c, (n) => n.localName === "button" && n.textContent.trim() === "Browse…");
  await click(c, browse[browse.length - 1]); // the folder form's Browse, below the add-project one
  await until(() => h.calls.some((x) => x.cmd === "workspaces_place_set"), "the folder to be saved");
  await settle(40);
  expect(h.calls.filter((x) => x.cmd === "workspaces_place_set").map((x) => x.args)).toEqual([{ dir: "D:/wt", flat: false }]);
  expect(valueOf(field(c))).toBe("D:/wt");
  expect(c.textContent).toContain("workspaces go under D:/wt, a folder per project");
  // Cancelling the picker saves nothing more.
  h.pick = null;
  await click(c, browse[browse.length - 1]);
  await settle(40);
  expect(h.calls.filter((x) => x.cmd === "workspaces_place_set")).toHaveLength(1);
});

test("box 2: with KOLUX_WORKSPACES_DIR supplying the folder the field shows it and says where it came from", async () => {
  h.place = { dir: "E:/from-env", flat: false, used: [], fromEnv: true };
  const c = await panel();
  await openByPath(c);
  await until(() => field(c) !== undefined, "the workspaces folder field");
  await settle(40);
  expect(valueOf(field(c))).toBe("E:/from-env");
  expect(c.textContent).toContain("Workspaces folder (from KOLUX_WORKSPACES_DIR)");
  expect(h.calls.some((x) => x.cmd === "workspaces_place_set")).toBe(false); // read, never saved: no Settings visit needed
});

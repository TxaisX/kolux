// T-689 (follow-ups to the T-687 UX audit): New group pressed twice leaves one unsaved group, the move and
// remove-group questions give focus back when they close, Escape works anywhere in the remove-group question,
// and the workspace delete button says Delete. The real ProjectsPanel on the small DOM, backend mocked.
import { createElement } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { type FakeDocument, type FakeNode, byLabel, byText, click, find, fire, installDom, mount, settle, typeInto } from "../tasks/fakeDom";

const h = vi.hoisted(() => ({ calls: [] as { cmd: string; args: unknown }[], groups: [] as { id: string; name: string; parent: string | null }[], rev: 1, made: 0, check: null as unknown, hold: "", release: () => {} }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: { id?: string }) => {
    h.calls.push({ cmd, args });
    const answer = () => Promise.resolve({ groups: h.groups, members: { p1: "g1" }, rev: ++h.rev });
    if (cmd === h.hold) return new Promise((done) => (h.release = () => done(cmd === "workspace_remove" ? null : answer()))); // answered when the test says
    if (cmd === "get_settings") return Promise.resolve({});
    if (cmd === "workspace_remove_check") return Promise.resolve(h.check);
    if (cmd === "workspace_statuses") return Promise.resolve({ list: [] });
    if (cmd === "visibility_get") return Promise.resolve([]);
    if (cmd === "project_list") return Promise.resolve([{ id: "p1", name: "app", path: "C:/w/app" }]);
    if (cmd === "workspace_scan") return Promise.resolve({ list: [main, ws, other], unseen: [] });
    if (cmd === "workspaces_place_get") return Promise.resolve({ dir: "", flat: false, used: [], fromEnv: false });
    if (cmd === "setup_suggestion") return Promise.resolve({ kind: "none" });
    if (cmd === "groups_get") return Promise.resolve({ groups: h.groups, members: { p1: "g1" }, rev: h.rev });
    if (cmd === "group_create") {
      h.groups = [...h.groups, { id: `n${++h.made}`, name: "", parent: null }];
      return answer();
    }
    if (cmd === "group_delete") {
      h.groups = h.groups.filter((x) => x.id !== args?.id);
      return answer();
    }
    if (cmd === "activity_get" || cmd === "project_icons_list") return Promise.resolve({});
    if (cmd === "skills_scan") return Promise.resolve({ skills: [] });
    return Promise.resolve(null);
  },
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: () => Promise.resolve(() => {}) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: () => Promise.resolve(null) }));

const base = { hidden: false, number: null, comment: "" };
const main = { ...base, path: "C:/w/app", branch: "main", head: "abc1234", isMain: true };
const ws = { ...base, path: "C:/w/ws/fix", branch: "fix", head: "c3c3c3c", isMain: false };
const other = { ...base, path: "C:/w/ws/other", branch: "other", head: "d4d4d4d", isMain: false };
let doc: FakeDocument;
let unmount: () => Promise<void> = async () => {};
const focused: string[] = [];

// What the panel looks for when it puts the keyboard back: the workspace row's .sess, the group's X, the New group button.
const focusable = (name: string) => ({ focus: () => void focused.push(name) });
beforeEach(() => {
  const dom = installDom();
  doc = dom.doc;
  Object.assign(dom.win, { setInterval, clearInterval, setTimeout, clearTimeout });
  Object.assign(doc, {
    querySelectorAll: (sel: string) => (sel.includes("[data-path]") ? [{ dataset: { path: ws.path }, querySelector: () => focusable("row") }] : []),
    querySelector: (sel: string) => (sel.includes('[data-project-group="g1"] [data-group-x]') ? focusable("group-x") : sel.includes("New group") ? focusable("new-group") : null),
    visibilityState: "visible",
    hidden: false,
  });
  h.calls = [];
  h.groups = [{ id: "g1", name: "Clients", parent: null }];
  h.rev = 1;
  h.made = 0;
  h.hold = "";
  h.check = { changes: [], locked: null, nested: [], stamp: "s", commits: [] };
  focused.length = 0;
});
afterEach(async () => {
  await unmount();
  unmount = async () => {};
});

async function panel() {
  const { default: ProjectsPanel } = await import("./ProjectsPanel");
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
const hasText = (c: FakeNode, t: string) => find(c, (n) => n.textContent.includes(t)).length > 0;
const deletes = () => h.calls.filter((x) => x.cmd === "group_delete").map((x) => (x.args as { id: string }).id);
const newGroup = (c: FakeNode) => byLabel(c, "button", "New group")[0];
const groupX = (c: FakeNode) => find(c, (n) => n.attrs["data-group-x"] !== undefined)[0];
const settingsOf = (c: FakeNode, id: string) => find(c, (n) => n.attrs["data-group-settings"] === id);
const escape = (c: FakeNode, on: FakeNode) => fire(c, "keydown", on, { key: "Escape" });

test("New group pressed twice with the first still unsaved drops the first and keeps one", async () => {
  const c = await panel();
  await click(c, newGroup(c));
  await settle(60);
  expect(deletes()).toEqual([]);
  await click(c, newGroup(c));
  await settle(60);
  expect(deletes()).toEqual(["n1"]);
  expect(h.groups.map((x) => x.id)).toEqual(["g1", "n2"]);
});

test("a new group that was saved first stays when New group is pressed again", async () => {
  const c = await panel();
  await click(c, newGroup(c));
  await settle(60);
  await click(c, byText(c, "button", "Save")[0]);
  await settle(60);
  await click(c, newGroup(c));
  await settle(60);
  expect(deletes()).toEqual([]);
  expect(h.groups.map((x) => x.id)).toEqual(["g1", "n1", "n2"]);
});

test("New group pressed while the first group's Save is still being answered keeps the saved group", async () => {
  const c = await panel();
  await click(c, newGroup(c));
  await settle(60);
  await typeInto(c, byLabel(c, "input", "group name")[0], "Acme");
  h.hold = "group_rename";
  await click(c, byText(c, "button", "Save")[0]);
  await click(c, newGroup(c));
  await settle(60);
  h.release();
  await settle(60);
  expect(h.calls.some((x) => x.cmd === "group_rename")).toBe(true);
  expect(deletes()).toEqual([]);
  expect(h.groups.map((x) => x.id)).toEqual(["g1", "n1", "n2"]);
  // n1's answer closes only n1's form: n2's stays open, so closing it unsaved still takes n2 away
  expect(settingsOf(c, "n2").length).toBe(1);
  await click(c, byText(c, "button", "Cancel")[0]);
  await settle(60);
  expect(deletes()).toEqual(["n2"]);
});

test("Cancel pressed while a new group's Save is still being answered keeps the saved group", async () => {
  const c = await panel();
  await click(c, newGroup(c));
  await settle(60);
  await typeInto(c, byLabel(c, "input", "group name")[0], "Acme");
  h.hold = "group_rename";
  await click(c, byText(c, "button", "Save")[0]);
  await click(c, byText(c, "button", "Cancel")[0]);
  await settle(60);
  h.release();
  await settle(60);
  expect(deletes()).toEqual([]);
  expect(h.groups.map((x) => x.id)).toEqual(["g1", "n1"]);
});

test("a new group deleted from its own form is not removed a second time by the next New group", async () => {
  const c = await panel();
  await click(c, newGroup(c));
  await settle(60);
  await click(c, byText(c, "button", "Delete…")[0]);
  await click(c, byText(c, "button", "Delete group")[0]);
  await settle(60);
  await click(c, newGroup(c));
  await settle(60);
  expect(deletes()).toEqual(["n1"]);
});

test("Escape on the remove-group question's checkbox keeps the group, and Keep it puts focus back on the group's X", async () => {
  const c = await panel();
  await click(c, groupX(c));
  expect(hasText(c, "Delete Clients?")).toBe(true);
  await escape(c, byLabel(c, "input", "also remove the projects")[0]);
  await settle(20);
  expect(hasText(c, "Delete Clients?")).toBe(false);
  expect(deletes()).toEqual([]);
  expect(focused).toEqual(["group-x"]);
  await click(c, groupX(c));
  await click(c, byText(c, "button", "Keep it")[0]);
  await settle(20);
  expect(hasText(c, "Delete Clients?")).toBe(false);
  expect(focused).toEqual(["group-x", "group-x"]);
});

test("Delete group closes the question, deletes the group and puts focus on New group", async () => {
  const c = await panel();
  await click(c, groupX(c));
  await click(c, byText(c, "button", "Delete group")[0]);
  await settle(60);
  expect(deletes()).toEqual(["g1"]);
  expect(focused).toEqual(["new-group"]);
});

const moveButton = (c: FakeNode) => find(c, (n) => String(n.attrs.title ?? "").startsWith("Set parent") && n.attrs["aria-expanded"] !== undefined);
const moveForm = (c: FakeNode) => find(c, (n) => n.attrs["data-moving"] !== undefined);
const openMove = async (c: FakeNode) => {
  await click(c, moveButton(c).find((b) => String(b.attrs["aria-expanded"]) === "false")!);
  await settle(20);
};

test("the move question gives focus back to the row on Cancel, on Escape and after picking a parent", async () => {
  const c = await panel();
  await openMove(c);
  expect(moveForm(c).length).toBe(1);
  await click(c, byText(c, "button", "Cancel")[0]);
  await settle(20);
  expect(moveForm(c).length).toBe(0);
  expect(focused).toEqual(["row"]);
  await openMove(c);
  await escape(c, byText(c, "button", "Cancel")[0]);
  await settle(20);
  expect(moveForm(c).length).toBe(0);
  expect(focused).toEqual(["row", "row"]);
  await openMove(c);
  await fire(c, "mousedown", find(c, (n) => n.attrs.role === "option" && n.attrs.title === other.path)[0]);
  await settle(40);
  expect(h.calls.some((x) => x.cmd === "workspace_set_parent")).toBe(true);
  expect(moveForm(c).length).toBe(0);
  expect(focused).toEqual(["row", "row", "row"]);
});

test("the workspace delete question and its button say Delete, not Remove, and it shows Deleting… while it works", async () => {
  const c = await panel();
  await click(c, find(c, (n) => String(n.attrs.title ?? "").startsWith("Delete this workspace"))[0]);
  await settle(60);
  expect(hasText(c, "Delete fix and its folder?")).toBe(true);
  expect(hasText(c, "Remove fix")).toBe(false);
  expect(byText(c, "button", "Delete").length).toBe(1);
  expect(byText(c, "button", "Remove")).toEqual([]);
  h.hold = "workspace_remove";
  await click(c, byText(c, "button", "Delete")[0]);
  await settle(60);
  expect(byText(c, "button", "Deleting…").length).toBe(1);
  expect(find(c, (n) => n.localName === "button" && n.textContent.trim().startsWith("Removing"))).toEqual([]);
  h.release();
  await settle(60);
  expect(h.calls.some((x) => x.cmd === "workspace_remove")).toBe(true);
}, 15000);

// C28-R1-01: the Rust removal cannot be cancelled, so the question must not offer a back-out that only
// closes the dialog while the folder still goes. Keep, Escape and a click outside go nowhere until it ends.
test("Keep and Escape cannot back out of the delete question while the removal runs", async () => {
  const c = await panel();
  await click(c, find(c, (n) => String(n.attrs.title ?? "").startsWith("Delete this workspace"))[0]);
  await settle(60);
  h.hold = "workspace_remove";
  await click(c, byText(c, "button", "Delete")[0]);
  await settle(60);
  expect(find(c, (n) => n.localName === "button" && n.textContent.trim().startsWith("Deleting")).length).toBe(1);
  await click(c, byText(c, "button", "Keep")[0]);
  await settle(20);
  expect(hasText(c, "Delete fix and its folder?")).toBe(true);
  await escape(c, find(c, (n) => n.attrs.role === "alertdialog")[0]);
  await settle(20);
  expect(hasText(c, "Delete fix and its folder?")).toBe(true);
  expect(byText(c, "button", "Keep")[0].attrs["aria-disabled"]).toBe("true");
  h.release();
  await settle(60);
  expect(h.calls.some((x) => x.cmd === "workspace_remove")).toBe(true);
}, 15000);

test("the project question keeps Remove project", async () => {
  const c = await panel();
  await click(c, find(c, (n) => n.attrs["data-proj-x"] !== undefined)[0]);
  expect(byText(c, "button", "Remove app").length).toBe(1);
});

// T-613 (F04-projects-scm.1): deleting a workspace never silently deletes commits found on no other
// branch and on no remote. The real ProjectsPanel and the multi-select bar on the small DOM, with
// the backend mocked: the single question names the commits and starts with Keep the branch ticked
// (even with the question switched off in settings), and the parent-with-children batch and the
// multi-select send no branch choice (null: the workspace's own record decides, and the backend
// keeps a branch holding such commits) instead of forcing the branch away.
import { createElement, useState } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { type FakeDocument, type FakeNode, byText, click, find, fire, installDom, mount, settle, withText } from "../tasks/fakeDom";

const h = vi.hoisted(() => ({ wt: [] as unknown[], calls: [] as { cmd: string; args: Record<string, unknown> }[], checks: {} as Record<string, unknown>, kept: {} as Record<string, unknown>, hovered: "" }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args: Record<string, unknown> = {}) => {
    h.calls.push({ cmd, args });
    if (cmd === "workspace_remove_check") return Promise.resolve(h.checks[String(args.path)]);
    if (cmd === "get_settings") return Promise.resolve({ confirmWorkspaceDelete: false });
    if (cmd === "workspace_remove") return Promise.resolve(h.kept[String(args.path)] ?? null);
    if (cmd === "workspace_statuses") return Promise.resolve({ list: [] });
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
const fix = { ...base, path: "C:/w/ws/fix-login", branch: "fix-login", head: "c3c3c3c", isMain: false };
const child = { ...base, path: "C:/w/ws/fix-login-tests", branch: "fix-login-tests", head: "d4d4d4d", isMain: false, parent: fix.path };
const clean = { changes: [], locked: null, nested: [], commits: [] as string[] };
const THREE = ["c3c3c3c fix step 3", "b2b2b2b fix step 2", "a1a1a1a fix step 1"];

let doc: FakeDocument;
let unmount: () => Promise<void> = async () => {};
let pressDelete: () => Promise<void> = async () => {};

beforeEach(() => {
  const dom = installDom();
  doc = dom.doc;
  Object.assign(dom.win, { setInterval, clearInterval, setTimeout, clearTimeout });
  // the row under the pointer is h.hovered (the delete shortcut reads it)
  Object.assign(doc, { querySelectorAll: () => (h.hovered ? [{ dataset: { path: h.hovered } }] : []), querySelector: () => null, visibilityState: "visible", hidden: false });
  h.wt = [main, fix];
  h.calls = [];
  h.checks = { [fix.path]: { ...clean, stamp: "s-fix", commits: THREE }, [child.path]: { ...clean, stamp: "s-child" } };
  h.kept = {};
  h.hovered = fix.path;
});
afterEach(async () => {
  await unmount();
  unmount = async () => {};
});

async function panel(settings: Record<string, unknown> = {}) {
  const { default: ProjectsPanel } = await import("./ProjectsPanel");
  const { act } = await import("react");
  const props = {
    openDirs: ["C:/w/app"], sessions: [], states: {}, unread: new Set<string>(), onUnread: () => {}, settings, onSetting: () => {},
    activeDir: "C:/w/app", onSelect: () => {}, onRemoved: () => {}, onSleep: () => {}, agents: [], launching: false, onLaunch: () => {},
    defaultId: "claude", onSetDefault: () => {}, onChoose: () => {}, page: null, onPage: () => {}, refresh: 0, onIndex: () => {},
    createRequest: 0, onStartIn: () => {}, nest: true, onNest: () => {}, artifactsOn: false, onArtifacts: () => {},
  };
  // the host raises deleteRequest the way App does when the delete shortcut is pressed
  const Host = () => {
    const [n, setN] = useState(0);
    pressDelete = async () => {
      await act(async () => setN((v) => v + 1));
      await settle(60);
    };
    return createElement(ProjectsPanel, { ...props, deleteRequest: n } as never);
  };
  const m = await mount(createElement(Host), doc);
  unmount = m.unmount;
  await settle(120);
  return m.container as FakeNode;
}
const removes = () => h.calls.filter((c) => c.cmd === "workspace_remove").map((c) => c.args);
const question = (c: FakeNode) => find(c, (n) => n.attrs.role === "alertdialog" && n.textContent.includes("and its folder?"));
const keepBox = (c: FakeNode) => withText(c, "label", "Keep the branch")[0]?.childNodes.find((n) => n.localName === "input");

test("the delete question names the commits, starts with Keep the branch ticked, and is asked even with the question switched off", async () => {
  const c = await panel();
  await pressDelete();
  expect(removes(), "nothing is deleted before the answer").toEqual([]);
  expect(question(c).length).toBe(1);
  const text = question(c)[0].textContent;
  expect(text).toContain("3 commits are on no other branch and were never pushed");
  for (const line of THREE) expect(text).toContain(line);
  expect(keepBox(c)?.checked, "Keep the branch starts ticked").toBe(true);
  await click(c, byText(c, "button", "Delete")[0]);
  await settle(60);
  expect(removes()).toEqual([{ projectId: "p1", path: fix.path, force: false, stamp: "s-fix", keepBranch: true }]);
});

test("unticking Keep the branch is the user's own choice to delete it", async () => {
  const c = await panel();
  await pressDelete();
  const box = keepBox(c)!;
  box.checked = false; // the browser flips a checkbox before the click reaches the page
  await click(c, box);
  await settle(20);
  expect(keepBox(c)?.checked).toBe(false);
  await click(c, byText(c, "button", "Delete")[0]);
  await settle(60);
  expect(removes()).toEqual([{ projectId: "p1", path: fix.path, force: false, stamp: "s-fix", keepBranch: false }]);
});

test("a workspace with nothing to lose still skips the question when it is switched off", async () => {
  h.checks[fix.path] = { ...clean, stamp: "s-fix" };
  await panel();
  await pressDelete();
  expect(removes()).toEqual([{ projectId: "p1", path: fix.path, force: false, stamp: "s-fix", keepBranch: undefined }]);
});

test("Delete all on a parent with a child sends no branch choice, so the record and the backend decide", async () => {
  h.wt = [main, fix, child];
  const c = await panel();
  const row = find(c, (n) => n.attrs["data-path"] === fix.path)[0].childNodes.find((n) => String(n.attrs.className ?? n.attrs.class ?? "").includes("sess"))!;
  await fire(c, "contextmenu", row, { clientX: 5, clientY: 5, altKey: false });
  await settle(60);
  await click(c, byText(c, "button", "Delete")[0]);
  await settle(60);
  await click(c, byText(c, "button", "Delete all")[0]);
  await settle(120);
  expect(removes()).toEqual([
    { projectId: "p1", path: child.path, force: false, stamp: "s-child", keepBranch: null },
    { projectId: "p1", path: fix.path, force: false, stamp: "s-fix", keepBranch: null },
  ]);
});

test("the multi-select bar sends no branch choice either, and a branch the backend kept joins the kept list", async () => {
  h.kept[fix.path] = { branch: "fix-login", commit: "c3c3c3c" };
  const { PickedBar } = await import("../shell/ProjectsExtras");
  const kept: unknown[] = [];
  const names: Record<string, string> = { [fix.path]: "fix-login", [child.path]: "fix-login-tests" };
  const m = await mount(
    createElement(PickedBar, { picked: [fix.path, child.path], find: (p: string) => ({ projectId: "p1", name: names[p] }), onRemoved: () => {}, onKept: (items: unknown[]) => void kept.push(...items), onLeft: () => {}, onReload: () => {}, say: () => {} }),
    doc,
  );
  unmount = m.unmount;
  const c = m.container as FakeNode;
  await click(c, byText(c, "button", "Remove…")[0]);
  await settle(60);
  await click(c, byText(c, "button", "Remove 2")[0]);
  await settle(60);
  expect(removes()).toEqual([
    { projectId: "p1", path: fix.path, force: false, stamp: "s-fix", keepBranch: null },
    { projectId: "p1", path: child.path, force: false, stamp: "s-child", keepBranch: null },
  ]);
  expect(kept).toEqual([{ branch: "fix-login", commit: "c3c3c3c", projectId: "p1" }]);
});

test("T-729: a pinned workspace shown twice (pinned rows also in their group) asks in one dialog, not two", async () => {
  const c = await panel({ pinnedWorkspaces: [fix.path], pinnedCopies: true });
  expect(find(c, (n) => n.attrs["data-path"] === fix.path).length, "the row shows twice").toBe(2);
  await pressDelete();
  expect(question(c).length).toBe(1);
});

// W201 B2: Save on the unsaved question for an untitled note opens the name box, and that box is a dialog the
// guard opens over the caller's delete question, which stays mounted under it. It must take the guard's raised
// backdrop (`.ask-backdrop.guard`, one step over --z-top in styles.css), or it draws under the delete dialog and
// the mouse cannot reach it. The real ProjectsPanel, the real useCloseGuard and the real NamePrompt on the small
// DOM, with the buffer registry answering as an untitled note that holds typed text.
import { createElement } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { useCloseGuard } from "../editor/CloseDialog";
import type { GuardPane } from "../editor/closeGuard";
import { type FakeDocument, FakeNode, byLabel, byText, click, find, installDom, mount, settle } from "../tasks/fakeDom";
import { sameDir } from "../workspaces";
import ProjectsPanel from "./ProjectsPanel";
import { namesOf, panesInDirs, unsavedInDirs } from "./wsUnsaved";

const h = vi.hoisted(() => ({ calls: [] as string[], settings: {} as Record<string, unknown> }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string) => {
    h.calls.push(cmd);
    if (cmd === "get_settings") return Promise.resolve(h.settings);
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
// The tab holds typed text over the empty file Kolux made, so a save must ask for the name first (untitled.ts).
vi.mock("../editor/buffers", async (importOriginal) => {
  const real = await importOriginal<typeof import("../editor/buffers")>();
  return { ...real, isDirty: () => true, diskOf: () => "" };
});

const base = { hidden: false, number: null, comment: "" };
const main = { ...base, path: "C:/w/app", branch: "main", head: "abc1234", isMain: true };
const ws = { ...base, path: "C:/w/ws/fix", branch: "fix", head: "c3c3c3c", isMain: false };
const panes: GuardPane[] = [
  { key: 7, kind: "editor", path: "C:/w/ws/fix/untitled.md", cwd: "C:/w/ws/fix" },
  { key: 9, cwd: "C:/w/ws/fix" },
];
const dirty = { 7: true, 9: false };
const props = {
  openDirs: [], sessions: [], states: {}, unread: new Set<string>(), onUnread: () => {}, settings: {}, onSetting: () => {},
  activeDir: null, onSelect: () => {}, onSleep: () => {}, agents: [], launching: false, onLaunch: () => {},
  defaultId: "claude", onSetDefault: () => {}, onChoose: () => {}, page: null, onPage: () => {}, refresh: 0, onIndex: () => {},
  createRequest: 0, deleteRequest: 0, onStartIn: () => {}, nest: true, onNest: () => {}, artifactsOn: false, onArtifacts: () => {},
};
let doc: FakeDocument;
let unmount: () => Promise<void> = async () => {};

function Harness() {
  const guard = useCloseGuard({ panes, dirty, close: () => {}, toast: () => {} });
  return createElement(
    "div",
    null,
    guard.dialog,
    createElement(ProjectsPanel, {
      ...props,
      onRemoved: () => {},
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
  // The name box selects its text when it opens; the stand-in has no selection, so the call is a no-op.
  (FakeNode.prototype as { select?: () => void }).select = () => {};
  h.calls = [];
  h.settings = {};
});
afterEach(async () => {
  await unmount();
  unmount = async () => {};
  delete (FakeNode.prototype as { select?: () => void }).select;
});

const isDeleteX = (n: FakeNode) => n.localName === "button" && String(n.attrs.title ?? "").startsWith("Delete this workspace");
const delAsk = (c: FakeNode) => byLabel(c, "div", "Delete workspace")[0];
const guardAsk = (c: FakeNode) => byLabel(c, "div", "Save changes before closing?")[0];
const nameAsk = (c: FakeNode) => byLabel(c, "div", "Name this note")[0];

test("Save on an untitled note's question opens the name box on the guard's raised backdrop, over the delete dialog", async () => {
  const m = await mount(createElement(Harness), doc);
  unmount = m.unmount;
  const c = m.container as FakeNode;
  await settle(120);
  await click(c, find(c, isDeleteX)[0]);
  await settle(80);
  await click(c, byText(delAsk(c), "button", "Delete")[0]);
  await settle(80);
  const guard = guardAsk(c);
  expect(guard, "the question opened over the delete dialog").toBeDefined();
  const raised = guard.parentNode!;
  expect(raised.attrs.class, "the question's backdrop is the raised one").toBe("ask-backdrop guard");

  await click(c, byText(guard, "button", "Save")[0]);
  await settle(80);
  const prompt = nameAsk(c);
  expect(prompt, "Save on an untitled note asks for its name").toBeDefined();
  expect(prompt.parentNode!.attrs.class, "the name box takes the guard's raised backdrop, not the plain one").toBe(raised.attrs.class);
  expect(delAsk(c), "the delete dialog that asked is still mounted under it").toBeDefined();
  expect(h.calls).not.toContain("workspace_remove");
});

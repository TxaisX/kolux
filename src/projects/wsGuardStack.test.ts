// @vitest-environment happy-dom
// W201 B2: the unsaved question opens over the workspace delete question, which stays mounted under it while
// the caller awaits the answer. The question must take the keyboard from that dialog: Tab stays inside it, the
// first Escape closes only it, and the delete question answers again once it is gone. Both are src/ui (Base UI)
// dialogs on a real DOM (happy-dom): real focus and real key events.
import { createElement } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { useCloseGuard } from "../editor/CloseDialog";
import type { GuardPane } from "../editor/closeGuard";
import { type FakeDocument, type FakeNode, byLabel, byText, click, find, fire, installDom, mount, settle } from "../tasks/realDom";
import { sameDir } from "../workspaces";
import ProjectsPanel from "./ProjectsPanel";
import { namesOf, panesInDirs, unsavedInDirs } from "./wsUnsaved";

const h = vi.hoisted(() => ({ calls: [] as string[], settings: {} as Record<string, unknown>, scan: null as unknown }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string) => {
    h.calls.push(cmd);
    if (cmd === "get_settings") return Promise.resolve(h.settings);
    if (cmd === "cleanup_scan") return Promise.resolve(h.scan);
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

const base = { hidden: false, number: null, comment: "" };
const main = { ...base, path: "C:/w/app", branch: "main", head: "abc1234", isMain: true };
const ws = { ...base, path: "C:/w/ws/fix", branch: "fix", head: "c3c3c3c", isMain: false };
const panes: GuardPane[] = [
  { key: 7, kind: "editor", path: "C:/w/ws/fix/a.ts", cwd: "C:/w/ws/fix" },
  { key: 8, kind: "editor", path: "C:/w/ws/fix/b.md", cwd: "C:/w/ws/fix" },
  { key: 9, cwd: "C:/w/ws/fix" },
];
const dirty = { 7: true, 8: false, 9: false };
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
  Object.assign(doc, { visibilityState: "visible", hidden: false });
  h.calls = [];
  h.settings = {};
  h.scan = { projectId: "p1", rows: [], error: null, timedOut: false, atMs: 1 };
});
afterEach(async () => {
  await unmount();
  unmount = async () => {};
});

/** A key pressed where the keyboard is: a real keydown at the focused element (the window's capture listeners first). */
const press = (c: FakeNode, key: string) => fire(c, "keydown", doc.activeElement ?? doc.body, { key });

const isDeleteX = (n: FakeNode) => n.localName === "button" && String(n.attrs.title ?? "").startsWith("Delete this workspace");
const delAsk = (c: FakeNode) => byLabel(c, "div", "Delete workspace")[0];
const guardAsk = (c: FakeNode) => byLabel(c, "div", "Save changes before closing?")[0];

test("Tab stays in the unsaved question and the first Escape closes only it; the delete dialog works again after", async () => {
  const m = await mount(createElement(Harness), doc);
  unmount = m.unmount;
  const c = m.container as FakeNode;
  await settle(120);
  await click(c, find(c, isDeleteX)[0]);
  await settle(80);
  await click(c, byText(delAsk(c), "button", "Delete")[0]);
  await settle(80);
  const card = guardAsk(c);
  expect(card, "the question opened over the delete dialog").toBeDefined();
  expect(delAsk(c), "which stays mounted under it").toBeDefined();

  // Tab stays in the top dialog: Base UI keeps it inside (focus guards on both sides of the question, which a real
  // browser's Tab lands on and sends back in), and the delete dialog behind the scrim cannot take focus meanwhile.
  expect(card.contains(doc.activeElement), "focus is in the question").toBe(true);
  expect(find(card.parentElement!.parentElement!, (n) => n.hasAttribute("data-base-ui-focus-guard")).length, "the question's focus guards").toBeGreaterThanOrEqual(2);
  expect(delAsk(c).closest("[inert],[aria-hidden='true']"), "the delete dialog is out of reach under it").not.toBeNull();

  // The first Escape closes only the question. The delete dialog that asked it is still there, still pending.
  await press(c, "Escape");
  await settle(40);
  expect(guardAsk(c), "the first Escape closed the question").toBeUndefined();
  expect(delAsk(c), "and left the delete dialog that asked it").toBeDefined();
  expect(h.calls).not.toContain("workspace_remove");

  // The lower dialog answers again now that it is top.
  await press(c, "Escape");
  await settle(40);
  expect(delAsk(c), "the next Escape closes the delete dialog").toBeUndefined();
  expect(h.calls).not.toContain("workspace_remove");
});
